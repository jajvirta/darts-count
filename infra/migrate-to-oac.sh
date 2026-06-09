#!/usr/bin/env bash
#
# Switch the backend from a public (auth NONE) Lambda Function URL to a
# CloudFront-signed one (Origin Access Control, type "lambda" + Function URL
# AuthType=AWS_IAM). Needed when an AWS Organizations SCP/RCP forbids anonymous
# Function URL invocation (the persistent "AccessDeniedException / Function URL
# authorization" 403 even though the function's own config is correct).
#
# After this, the Function URL can ONLY be invoked by your CloudFront
# distribution (SigV4-signed via OAC); direct/anonymous calls are denied by
# design. Idempotent. Prompts before mutating the distribution (APPLY=1 skips).
#
# Usage:  aws-vault exec <profile> -- ./infra/migrate-to-oac.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
[[ -f "$SCRIPT_DIR/deploy.env" ]] && source "$SCRIPT_DIR/deploy.env"

REGION="${REGION:?set REGION in deploy.env}"
DISTRIBUTION_ID="${DISTRIBUTION_ID:?set DISTRIBUTION_ID in deploy.env}"
LAMBDA_NAME="${LAMBDA_NAME:-darts-practice-api}"
ORIGIN_ID="lambda-${LAMBDA_NAME}"
OAC_NAME="${LAMBDA_NAME}-oac"

command -v jq >/dev/null || { echo "jq is required"; exit 1; }

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
DIST_ARN="arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${DISTRIBUTION_ID}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo "Account:      $ACCOUNT_ID"
echo "Region:       $REGION"
echo "Lambda:       $LAMBDA_NAME"
echo "Distribution: $DISTRIBUTION_ID"
echo "Origin id:    $ORIGIN_ID"
echo

# ---------- 1. Lambda OAC (type lambda) ----------
OAC_ID="$(aws cloudfront list-origin-access-controls \
  --query "OriginAccessControlList.Items[?Name=='${OAC_NAME}'].Id | [0]" --output text 2>/dev/null || true)"
if [[ -z "$OAC_ID" || "$OAC_ID" == "None" ]]; then
  echo "==> Creating Origin Access Control $OAC_NAME (type lambda)"
  OAC_ID="$(aws cloudfront create-origin-access-control \
    --origin-access-control-config \
    "Name=${OAC_NAME},SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=lambda" \
    --query 'OriginAccessControl.Id' --output text)"
else
  echo "==> OAC $OAC_NAME exists ($OAC_ID)"
fi
echo "    OAC id: $OAC_ID"

# ---------- 2. Function URL -> AWS_IAM ----------
echo "==> Setting Function URL auth type = AWS_IAM"
aws lambda update-function-url-config --function-name "$LAMBDA_NAME" --region "$REGION" \
  --auth-type AWS_IAM >/dev/null

# ---------- 3. Resource policy: drop public-invoke, allow CloudFront only ----------
echo "==> Replacing invoke permission (CloudFront service principal, scoped to this distribution)"
aws lambda remove-permission --function-name "$LAMBDA_NAME" --region "$REGION" \
  --statement-id FunctionURLPublicInvoke >/dev/null 2>&1 || true
aws lambda remove-permission --function-name "$LAMBDA_NAME" --region "$REGION" \
  --statement-id AllowCloudFrontServicePrincipal >/dev/null 2>&1 || true
aws lambda add-permission --function-name "$LAMBDA_NAME" --region "$REGION" \
  --statement-id AllowCloudFrontServicePrincipal \
  --action lambda:InvokeFunctionUrl \
  --principal cloudfront.amazonaws.com \
  --source-arn "$DIST_ARN" >/dev/null

# ---------- 4. Attach OAC to the Lambda origin on the distribution ----------
echo "==> Fetching distribution config"
aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID" > "$TMP/dist.json"
ETAG="$(jq -r '.ETag' "$TMP/dist.json")"
jq '.DistributionConfig' "$TMP/dist.json" > "$TMP/config.json"

CURRENT_OAC="$(jq -r --arg id "$ORIGIN_ID" '.Origins.Items[] | select(.Id==$id) | .OriginAccessControlId // ""' "$TMP/config.json")"
if [[ "$CURRENT_OAC" == "$OAC_ID" ]]; then
  echo "==> Origin already has OAC $OAC_ID — distribution unchanged."
else
  jq --arg id "$ORIGIN_ID" --arg oac "$OAC_ID" '
    .Origins.Items |= map(if .Id == $id then (.OriginAccessControlId = $oac) else . end)
  ' "$TMP/config.json" > "$TMP/config-new.json"

  echo "==> Planned change to distribution $DISTRIBUTION_ID:"
  echo "    set OriginAccessControlId=$OAC_ID on origin '$ORIGIN_ID'"
  if [[ "${APPLY:-}" != "1" ]]; then
    read -r -p "Apply to distribution $DISTRIBUTION_ID? [y/N] " ans
    [[ "$ans" == "y" || "$ans" == "Y" ]] || { echo "Aborted (set APPLY=1 to skip)."; exit 1; }
  fi
  echo "==> Updating distribution"
  aws cloudfront update-distribution --id "$DISTRIBUTION_ID" --if-match "$ETAG" \
    --distribution-config "file://$TMP/config-new.json" >/dev/null
fi

echo
echo "==> Migration complete."
echo "    The Function URL is now invoke-only by CloudFront (OAC, SigV4)."
echo "    Direct/anonymous calls will 403 BY DESIGN — that is correct now."
echo "    Test only the through-CloudFront path (diagnose-backend.sh section 8),"
echo "    and allow a few minutes for the distribution to propagate."
