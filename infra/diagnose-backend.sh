#!/usr/bin/env bash
#
# Diagnose the power-scoring backend (CloudFront OAC + Function URL AWS_IAM).
# Pinpoints where a failure originates: the OAC signing / IAM auth, our
# origin-secret guard, the user secret, or CloudFront routing.
#
# Auth model:
#   - CloudFront signs every origin request via an OAC (SigV4), so the
#     Authorization header is RESERVED for that signature.
#   - The user secret therefore travels in the X-Api-Key header.
#   - A direct (un-signed) call to the Function URL is denied BY DESIGN.
#
# Read-only against AWS config; the LIVE section makes GETs plus one POST that
# it immediately deletes. Reads config from deploy.env. Secrets are masked.
#
# Usage:  aws-vault exec <profile> -- ./infra/diagnose-backend.sh
#
set -uo pipefail   # deliberately NOT -e: run every check even if some fail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
[[ -f "$SCRIPT_DIR/deploy.env" ]] && source "$SCRIPT_DIR/deploy.env"

REGION="${REGION:?set REGION in deploy.env}"
DISTRIBUTION_ID="${DISTRIBUTION_ID:?set DISTRIBUTION_ID in deploy.env}"
API_TOKEN="${API_TOKEN:?set API_TOKEN in deploy.env}"
ORIGIN_SECRET="${ORIGIN_SECRET:-}"
LAMBDA_NAME="${LAMBDA_NAME:-darts-practice-api}"
PATH_PATTERN="${PATH_PATTERN:-}"
ORIGIN_ID="lambda-${LAMBDA_NAME}"
PREFIX="${PATH_PATTERN%/\*}"; PREFIX="${PREFIX#/}"

command -v jq   >/dev/null || { echo "jq is required";   exit 1; }
command -v curl >/dev/null || { echo "curl is required"; exit 1; }

mask() { local s="$1" n=${#1}; (( n<=8 )) && printf '****(len %d)' "$n" || printf '%s…%s(len %d)' "${s:0:4}" "${s: -2}" "$n"; }
hr()   { printf '\n──────── %s ────────\n' "$1"; }
body_of() { sed '$d' <<<"$1"; }
code_of() { tail -n1 <<<"$1"; }

hr "config (from deploy.env)"
echo "region=$REGION  lambda=$LAMBDA_NAME  dist=$DISTRIBUTION_ID  app-prefix=${PREFIX:-<root>}  api=/${PREFIX:+$PREFIX/}api/*"
echo "API_TOKEN=$(mask "$API_TOKEN")   ORIGIN_SECRET=$([[ -n $ORIGIN_SECRET ]] && mask "$ORIGIN_SECRET" || echo '<empty>')"

# ---------------------------------------------------------------------------
hr "1. Function URL auth — expect AWS_IAM (CloudFront-signed model)"
FU="$(aws lambda get-function-url-config --function-name "$LAMBDA_NAME" --region "$REGION" 2>&1)"
FN_URL=""
if jq -e . <<<"$FU" >/dev/null 2>&1; then
  AUTH=$(jq -r .AuthType <<<"$FU"); FN_URL=$(jq -r .FunctionUrl <<<"$FU")
  echo "AuthType=$AUTH"; echo "Url=$FN_URL"
  if [[ "$AUTH" == "AWS_IAM" ]]; then echo "  PASS (OAC model)"
  elif [[ "$AUTH" == "NONE" ]]; then echo "  WARN AuthType=NONE — that's the old public model, blocked by the org guardrail. Run ./infra/migrate-to-oac.sh (or ./infra/backend.sh)."
  else echo "  FAIL unexpected AuthType=$AUTH"; fi
else
  echo "  FAIL — cannot read Function URL config:"; echo "$FU"
fi

# ---------------------------------------------------------------------------
hr "2. Resource policy — expect Allow lambda:InvokeFunctionUrl to cloudfront.amazonaws.com (this dist)"
POL="$(aws lambda get-policy --function-name "$LAMBDA_NAME" --region "$REGION" --query Policy --output text 2>&1)"
if jq -e . <<<"$POL" >/dev/null 2>&1; then
  jq '.Statement[] | {Sid,Effect,Principal,Action,Condition}' <<<"$POL"
  if jq -e '.Statement[] | select(.Effect=="Allow" and .Action=="lambda:InvokeFunctionUrl" and (.Principal.Service=="cloudfront.amazonaws.com"))' <<<"$POL" >/dev/null; then
    echo "  PASS CloudFront-scoped invoke statement present"
  else
    echo "  FAIL — no CloudFront invoke statement. Run ./infra/backend.sh (or migrate-to-oac.sh)."
  fi
else
  echo "  FAIL — NO resource policy. Run ./infra/backend.sh (or migrate-to-oac.sh)."
fi

# ---------------------------------------------------------------------------
hr "3. Lambda env — API_TOKEN must match deploy.env (the app sends it as X-Api-Key)"
ENVV="$(aws lambda get-function-configuration --function-name "$LAMBDA_NAME" --region "$REGION" --query 'Environment.Variables' 2>&1)"
LAMBDA_OS=""
if jq -e . <<<"$ENVV" >/dev/null 2>&1; then
  LAMBDA_OS=$(jq -r '.ORIGIN_SECRET // ""' <<<"$ENVV")
  LAMBDA_TOK=$(jq -r '.API_TOKEN // ""' <<<"$ENVV")
  echo "TABLE_NAME=$(jq -r '.TABLE_NAME // "<unset>"' <<<"$ENVV")"
  echo "API_TOKEN(lambda)=$([[ -n $LAMBDA_TOK ]] && mask "$LAMBDA_TOK" || echo '<unset>')"
  echo "ORIGIN_SECRET(lambda)=$([[ -n $LAMBDA_OS ]] && mask "$LAMBDA_OS" || echo '<empty>')"
  if [[ "$LAMBDA_TOK" == "$API_TOKEN" ]]; then echo "  PASS user secret matches"
  else echo "  WARN API_TOKEN in deploy.env != Lambda (that would be a 401)"; fi
else
  echo "  FAIL — cannot read function configuration:"; echo "$ENVV"
fi

# ---------------------------------------------------------------------------
hr "4. OAC attached to the Lambda origin (+ optional origin secret)"
CFG="$(aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID" 2>/dev/null)"
OAC_ON_ORIGIN="$(jq -r --arg id "$ORIGIN_ID" '.DistributionConfig.Origins.Items[] | select(.Id==$id) | .OriginAccessControlId // ""' <<<"$CFG")"
echo "Origin '$ORIGIN_ID' OriginAccessControlId=${OAC_ON_ORIGIN:-<none>}"
[[ -n "$OAC_ON_ORIGIN" ]] && echo "  PASS OAC attached" || echo "  FAIL no OAC on the origin — CloudFront isn't signing. Run migrate-to-oac.sh / backend.sh."
CF_OS="$(jq -r --arg id "$ORIGIN_ID" '.DistributionConfig.Origins.Items[] | select(.Id==$id) | (.CustomHeaders.Items[]? | select(.HeaderName=="X-Origin-Secret") | .HeaderValue) // ""' <<<"$CFG")"
if [[ -z "$ORIGIN_SECRET" && -z "$LAMBDA_OS" ]]; then echo "  origin-secret guard disabled (ok)"
elif [[ "$CF_OS" == "$LAMBDA_OS" ]]; then echo "  PASS X-Origin-Secret matches"
else echo "  FAIL X-Origin-Secret mismatch → Lambda returns {\"error\":\"forbidden\"}"; fi

# ---------------------------------------------------------------------------
hr "5. CloudFront behaviors — '/${PREFIX:+$PREFIX/}api/*' must be FIRST and allow POST"
jq '.DistributionConfig.CacheBehaviors.Items | map({PathPattern,TargetOriginId,methods:.AllowedMethods.Items})' <<<"$CFG"

# ---------------------------------------------------------------------------
hr "6. LIVE — direct Function URL with X-Api-Key (must be DENIED under AWS_IAM)"
echo "A direct call isn't SigV4-signed, so AWS_IAM rejects it. A 403 here is EXPECTED and good."
if [[ -n "$FN_URL" ]]; then
  URL="${FN_URL%/}/sessions"
  R=$(curl -s -m 15 -w $'\n%{http_code}' -H "X-Api-Key: $API_TOKEN" "$URL")
  C=$(code_of "$R"); B=$(body_of "$R")
  echo "GET $URL"; echo "HTTP $C"; echo "$B"
  if [[ "$C" == 403 ]]; then echo "  EXPECTED — direct/unsigned access is denied; IAM auth is active."
  elif [[ "$C" == 200 ]]; then echo "  WARN — direct call succeeded; AuthType may still be NONE (see section 1)."
  else echo "  note: status $C"; fi
else echo "  (skipped: no Function URL)"; fi

# ---------------------------------------------------------------------------
hr "7. LIVE — through CloudFront, X-Api-Key only, NO Authorization (the real test)"
echo "Sends NO Authorization header so it can't clobber the OAC signature."
CF_DOMAIN="$(aws cloudfront get-distribution --id "$DISTRIBUTION_ID" --query 'Distribution.DomainName' --output text 2>/dev/null)"
if [[ -n "$CF_DOMAIN" && "$CF_DOMAIN" != "None" ]]; then
  CFURL="https://${CF_DOMAIN}/${PREFIX:+$PREFIX/}api/sessions"
  echo "POST $CFURL"
  R=$(curl -s -m 20 -w $'\n%{http_code}' -X POST "$CFURL" \
        -H "X-Api-Key: $API_TOKEN" -H 'content-type: application/json' \
        -d '{"date":"2000-01-01","type":"technique","target":"diag","darts":1,"score":0,"notes":"diagnostic-delete-me"}')
  C=$(code_of "$R"); B=$(body_of "$R")
  echo "HTTP $C"; echo "$B"
  case "$C" in
    201) echo "  PASS end-to-end works."
         ID=$(jq -r '.session.id // empty' <<<"$B" 2>/dev/null)
         [[ -n "$ID" ]] && curl -s -m 15 -o /dev/null -X DELETE "${CFURL}/$ID" -H "X-Api-Key: $API_TOKEN" \
            && echo "  (cleaned up diagnostic row $ID)" ;;
    403) if grep -qi 'signature' <<<"$B"; then echo "  >> SigV4 mismatch — something is still sending/forwarding an Authorization header that overrides the OAC signature. Make sure no client sends Authorization (we use X-Api-Key).";
         elif grep -qi '"error":"forbidden"' <<<"$B"; then echo "  >> origin-secret mismatch (section 4).";
         elif grep -qi 'Function URL authorization\|AccessDenied' <<<"$B"; then echo "  >> OAC/permission not effective (sections 1,2,4).";
         elif grep -qi '<Error>\|<Code>AccessDenied' <<<"$B"; then echo "  >> routed to S3, not Lambda (section 5).";
         else echo "  >> 403 — see body."; fi ;;
    401) echo "  >> user secret mismatch — X-Api-Key != Lambda API_TOKEN (section 3)." ;;
    *)   echo "  >> see body above." ;;
  esac
else echo "  FAIL — cannot read distribution domain name."; fi

echo; echo "Summary: section 7 returning 201 means the whole path works. Section 6's 403 is expected."
