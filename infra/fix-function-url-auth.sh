#!/usr/bin/env bash
#
# Fix the Lambda Function URL "AccessDeniedException / Function URL authorization"
# 403: force auth type NONE, then clear any stale public-invoke statement and add
# a correct one (add-permission won't overwrite an existing/malformed statement,
# so we remove first). Idempotent — safe to re-run.
#
# Usage:  aws-vault exec <profile> -- ./infra/fix-function-url-auth.sh
# Reads LAMBDA_NAME / REGION from deploy.env (gitignored).
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
[[ -f "$SCRIPT_DIR/deploy.env" ]] && source "$SCRIPT_DIR/deploy.env"

REGION="${REGION:?set REGION in deploy.env}"
LAMBDA_NAME="${LAMBDA_NAME:-darts-practice-api}"
SID="FunctionURLPublicInvoke"

echo "==> Function: $LAMBDA_NAME ($REGION)"

echo "==> Forcing Function URL auth type = NONE"
aws lambda update-function-url-config --function-name "$LAMBDA_NAME" --region "$REGION" \
  --auth-type NONE >/dev/null

echo "==> Removing any stale '$SID' statement (ok if it doesn't exist)"
aws lambda remove-permission --function-name "$LAMBDA_NAME" --region "$REGION" \
  --statement-id "$SID" >/dev/null 2>&1 || true

echo "==> Granting public invoke (lambda:InvokeFunctionUrl, Principal *, AuthType NONE)"
aws lambda add-permission --function-name "$LAMBDA_NAME" --region "$REGION" \
  --statement-id "$SID" --action lambda:InvokeFunctionUrl \
  --principal "*" --function-url-auth-type NONE >/dev/null

echo
echo "==> Verify — AuthType:"
aws lambda get-function-url-config --function-name "$LAMBDA_NAME" --region "$REGION" \
  --query AuthType --output text
echo "==> Verify — resource policy statements:"
aws lambda get-policy --function-name "$LAMBDA_NAME" --region "$REGION" \
  --query Policy --output text 2>/dev/null | jq '.Statement[] | {Sid,Effect,Principal,Action,Condition}' \
  || echo "  (no resource policy — add-permission above should have created one)"

echo
echo "==> Done. Re-test:  ./infra/diagnose-backend.sh   (or your curl)."
