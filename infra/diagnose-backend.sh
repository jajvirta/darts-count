#!/usr/bin/env bash
#
# Diagnose 403s from the power-scoring backend. Pinpoints whether the 403 comes
# from the Lambda Function URL's auth layer, our origin-secret guard, the bearer
# token, or CloudFront routing — and prints the exact fix for the first failure.
#
# Read-only against AWS config. The LIVE section makes real API calls: GETs
# (harmless) plus one POST that it immediately deletes to clean up.
#
# Usage:  aws-vault exec <profile> -- ./infra/diagnose-backend.sh
# Reads config from deploy.env (gitignored). Secrets are masked in output.
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
# split a "body\nCODE" curl result
body_of() { sed '$d' <<<"$1"; }
code_of() { tail -n1 <<<"$1"; }

hr "config (from deploy.env)"
echo "region=$REGION  lambda=$LAMBDA_NAME  dist=$DISTRIBUTION_ID  app-prefix=${PREFIX:-<root>}  api=/${PREFIX:+$PREFIX/}api/*"
echo "API_TOKEN=$(mask "$API_TOKEN")   ORIGIN_SECRET=$([[ -n $ORIGIN_SECRET ]] && mask "$ORIGIN_SECRET" || echo '<empty>')"

# ---------------------------------------------------------------------------
hr "1. Function URL config — AuthType MUST be NONE"
FU="$(aws lambda get-function-url-config --function-name "$LAMBDA_NAME" --region "$REGION" 2>&1)"
FN_URL=""
if jq -e . <<<"$FU" >/dev/null 2>&1; then
  AUTH=$(jq -r .AuthType <<<"$FU"); FN_URL=$(jq -r .FunctionUrl <<<"$FU")
  echo "AuthType=$AUTH"; echo "Url=$FN_URL"
  if [[ "$AUTH" == "NONE" ]]; then echo "  PASS"; else
    echo "  FAIL — AuthType is $AUTH, must be NONE. Fix:"
    echo "    aws lambda update-function-url-config --function-name $LAMBDA_NAME --region $REGION --auth-type NONE"
  fi
else
  echo "  FAIL — cannot read Function URL config:"; echo "$FU"
fi

# ---------------------------------------------------------------------------
hr "2. Resource policy — needs Allow lambda:InvokeFunctionUrl, Principal *, FunctionUrlAuthType=NONE"
POL="$(aws lambda get-policy --function-name "$LAMBDA_NAME" --region "$REGION" --query Policy --output text 2>&1)"
if jq -e . <<<"$POL" >/dev/null 2>&1; then
  jq '.Statement[] | {Sid,Effect,Principal,Action,Condition}' <<<"$POL"
  if jq -e '.Statement[] | select(.Effect=="Allow" and .Action=="lambda:InvokeFunctionUrl" and (.Condition.StringEquals."lambda:FunctionUrlAuthType"=="NONE"))' <<<"$POL" >/dev/null; then
    echo "  PASS public-invoke statement present"
  else
    echo "  FAIL — no valid public-invoke statement. This is the usual cause of the"
    echo "         AccessDeniedException ('Function URL authorization') 403."
    echo "         A malformed statement with the same Sid blocks re-adding, so remove"
    echo "         it first, then add a correct one:"
    echo "    aws lambda remove-permission --function-name $LAMBDA_NAME --region $REGION \\"
    echo "      --statement-id FunctionURLPublicInvoke   # ignore error if it doesn't exist"
    echo "    aws lambda add-permission --function-name $LAMBDA_NAME --region $REGION \\"
    echo "      --statement-id FunctionURLPublicInvoke --action lambda:InvokeFunctionUrl \\"
    echo "      --principal '*' --function-url-auth-type NONE"
  fi
else
  echo "  FAIL — NO resource policy at all. This causes the 403. Fix:"
  echo "    aws lambda add-permission --function-name $LAMBDA_NAME --region $REGION \\"
  echo "      --statement-id FunctionURLPublicInvoke --action lambda:InvokeFunctionUrl \\"
  echo "      --principal '*' --function-url-auth-type NONE"
fi

# ---------------------------------------------------------------------------
hr "3. Lambda environment — API_TOKEN must match deploy.env"
ENVV="$(aws lambda get-function-configuration --function-name "$LAMBDA_NAME" --region "$REGION" --query 'Environment.Variables' 2>&1)"
LAMBDA_OS=""
if jq -e . <<<"$ENVV" >/dev/null 2>&1; then
  LAMBDA_OS=$(jq -r '.ORIGIN_SECRET // ""' <<<"$ENVV")
  LAMBDA_TOK=$(jq -r '.API_TOKEN // ""' <<<"$ENVV")
  echo "TABLE_NAME=$(jq -r '.TABLE_NAME // "<unset>"' <<<"$ENVV")"
  echo "API_TOKEN(lambda)=$([[ -n $LAMBDA_TOK ]] && mask "$LAMBDA_TOK" || echo '<unset>')"
  echo "ORIGIN_SECRET(lambda)=$([[ -n $LAMBDA_OS ]] && mask "$LAMBDA_OS" || echo '<empty>')"
  if [[ "$LAMBDA_TOK" == "$API_TOKEN" ]]; then echo "  PASS bearer token matches"
  else echo "  WARN API_TOKEN in deploy.env != Lambda (that would be a 401, not 403)"; fi
else
  echo "  FAIL — cannot read function configuration:"; echo "$ENVV"
fi

# ---------------------------------------------------------------------------
hr "4. Origin secret — CloudFront header MUST equal Lambda ORIGIN_SECRET"
CF_OS="$(aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID" 2>/dev/null \
  | jq -r --arg id "$ORIGIN_ID" '.DistributionConfig.Origins.Items[] | select(.Id==$id) | (.CustomHeaders.Items[]? | select(.HeaderName=="X-Origin-Secret") | .HeaderValue) // ""')"
echo "CloudFront sends X-Origin-Secret=$([[ -n $CF_OS ]] && mask "$CF_OS" || echo '<none>')"
if [[ -z "$ORIGIN_SECRET" && -z "$LAMBDA_OS" ]]; then echo "  guard disabled on both sides (ok)"
elif [[ "$CF_OS" == "$LAMBDA_OS" ]]; then echo "  PASS matches"
else echo "  FAIL mismatch → Lambda returns {\"error\":\"forbidden\"} for CloudFront requests"; fi

# ---------------------------------------------------------------------------
hr "5. CloudFront behaviors — '/${PREFIX:+$PREFIX/}api/*' must be FIRST and allow POST"
aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID" 2>/dev/null \
  | jq '.DistributionConfig.CacheBehaviors.Items | map({PathPattern,TargetOriginId,methods:.AllowedMethods.Items})'

# ---------------------------------------------------------------------------
hr "6. LIVE — direct Function URL, bearer only (no origin secret)"
echo "Isolates the Function URL auth layer (method-agnostic, so GET reproduces a POST 403)."
if [[ -n "$FN_URL" ]]; then
  URL="${FN_URL%/}/sessions"
  R=$(curl -s -m 15 -w $'\n%{http_code}' -H "Authorization: Bearer $API_TOKEN" "$URL")
  C=$(code_of "$R"); B=$(body_of "$R")
  echo "GET $URL"; echo "HTTP $C"; echo "$B"
  if [[ "$C" == 403 ]] && grep -qi 'Function URL authorization\|AccessDenied' <<<"$B"; then
    echo "  >> ROOT CAUSE: the Function URL itself denies invoke. Fix sections 1 & 2, then re-run."
  elif [[ "$C" == 403 ]] && grep -qi '"error":"forbidden"' <<<"$B"; then
    echo "  >> Function URL invoke WORKS — this 403 is our origin-secret guard (expected: direct call sends no X-Origin-Secret). Look at CloudFront (sections 4/8)."
  elif [[ "$C" == 401 ]]; then
    echo "  >> Function URL invoke works; bearer token mismatch (section 3)."
  elif [[ "$C" == 200 ]]; then
    echo "  >> Function URL invoke works; origin-secret guard not enforced (ORIGIN_SECRET empty in Lambda)."
  else echo "  >> unexpected — see body above."; fi
else echo "  (skipped: no Function URL)"; fi

# ---------------------------------------------------------------------------
hr "7. LIVE — direct Function URL, bearer + X-Origin-Secret (full handler path)"
if [[ -n "$FN_URL" ]]; then
  URL="${FN_URL%/}/sessions"
  R=$(curl -s -m 15 -w $'\n%{http_code}' -H "Authorization: Bearer $API_TOKEN" \
        ${ORIGIN_SECRET:+-H "X-Origin-Secret: $ORIGIN_SECRET"} "$URL")
  C=$(code_of "$R"); B=$(body_of "$R")
  echo "HTTP $C"; echo "$B"
  [[ "$C" == 200 ]] && echo "  PASS handler fully works when called directly." \
                    || echo "  >> still failing with both secrets present — see body."
else echo "  (skipped: no Function URL)"; fi

# ---------------------------------------------------------------------------
hr "8. LIVE — through CloudFront (the exact path the app/POST uses)"
CF_DOMAIN="$(aws cloudfront get-distribution --id "$DISTRIBUTION_ID" --query 'Distribution.DomainName' --output text 2>/dev/null)"
if [[ -n "$CF_DOMAIN" && "$CF_DOMAIN" != "None" ]]; then
  CFURL="https://${CF_DOMAIN}/${PREFIX:+$PREFIX/}api/sessions"
  echo "POST $CFURL"
  R=$(curl -s -m 20 -w $'\n%{http_code}' -X POST "$CFURL" \
        -H "Authorization: Bearer $API_TOKEN" -H 'content-type: application/json' \
        -d '{"date":"2000-01-01","type":"technique","target":"diag","darts":1,"score":0,"notes":"diagnostic-delete-me"}')
  C=$(code_of "$R"); B=$(body_of "$R")
  echo "HTTP $C"; echo "$B"
  case "$C" in
    201) echo "  PASS end-to-end POST works."
         ID=$(jq -r '.session.id // empty' <<<"$B" 2>/dev/null)
         if [[ -n "$ID" ]]; then
           curl -s -m 15 -o /dev/null -X DELETE "${CFURL}/$ID" -H "Authorization: Bearer $API_TOKEN" \
             && echo "  (cleaned up diagnostic row $ID)"
         fi ;;
    403) if grep -qi 'Function URL authorization\|AccessDenied"' <<<"$B"; then echo "  >> Function URL invoke denied (sections 1 & 2).";
         elif grep -qi '"error":"forbidden"' <<<"$B"; then echo "  >> origin-secret mismatch (section 4).";
         elif grep -qi '<Error>\|<Code>AccessDenied' <<<"$B"; then echo "  >> request routed to S3, not Lambda (section 5).";
         else echo "  >> CloudFront 403 — likely method not allowed on the matched behavior (section 5)."; fi ;;
    *)   echo "  >> see body above." ;;
  esac
else echo "  FAIL — cannot read distribution domain name."; fi

echo; echo "Summary: the first FAIL / ROOT CAUSE line above is your 403. Apply its fix (or re-run ./infra/backend.sh) and run this again."
