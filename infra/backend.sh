#!/usr/bin/env bash
#
# Provision (idempotently) the personal power-scoring backend:
#   1. a DynamoDB table (on-demand) holding sessions
#   2. an IAM role for the Lambda (basic logs + table access)
#   3. a Node 20 Lambda (no bundled deps; AWS SDK from the runtime)
#   4. a Lambda Function URL (auth NONE; guarded by a bearer token +
#      a CloudFront-injected origin secret)
#   5. on your EXISTING distribution: a Lambda origin + an ORDERED
#      cache behavior for the API path, inserted BEFORE the app behavior
#
# Safe to re-run: updates the function code/config, and only mutates the
# distribution when the origin/behavior are missing (prompts first).
#
# Usage:  aws-vault exec <profile> -- ./infra/backend.sh
#         APPLY=1 aws-vault exec <profile> -- ./infra/backend.sh   # skip prompt
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
[[ -f "$SCRIPT_DIR/deploy.env" ]] && source "$SCRIPT_DIR/deploy.env"

: "${REGION:?Set REGION in deploy.env}"
: "${DISTRIBUTION_ID:?Set DISTRIBUTION_ID in deploy.env}"
: "${API_TOKEN:?Set API_TOKEN in deploy.env (the bearer secret to paste into the app)}"
PATH_PATTERN="${PATH_PATTERN:-}"
ORIGIN_SECRET="${ORIGIN_SECRET:-}"
TABLE_NAME="${TABLE_NAME:-darts-practice}"
LAMBDA_NAME="${LAMBDA_NAME:-darts-practice-api}"
LAMBDA_ROLE="${LAMBDA_ROLE:-darts-practice-api-role}"

command -v jq  >/dev/null || { echo "jq is required";  exit 1; }
command -v zip >/dev/null || { echo "zip is required"; exit 1; }

# API path mirrors the app prefix: "/darts/*" -> "/darts/api/*"; empty -> "/api/*"
PREFIX="${PATH_PATTERN%/\*}"; PREFIX="${PREFIX#/}"
if [[ -n "$PREFIX" ]]; then API_PATTERN="/${PREFIX}/api/*"; else API_PATTERN="/api/*"; fi

ORIGIN_ID="lambda-${LAMBDA_NAME}"
CACHING_DISABLED="4135ea2d-6df8-44a3-9df3-4b5a84be39ad"           # AWS managed
ALL_VIEWER_EXCEPT_HOST="b689b0a8-53d0-40ab-baf2-68738e2966ac"     # AWS managed (for Lambda/ALB origins)

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
TABLE_ARN="arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${TABLE_NAME}"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${LAMBDA_ROLE}"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

if [[ -n "$ORIGIN_SECRET" ]]; then GUARD_DESC="X-Origin-Secret enabled"; else GUARD_DESC="none (bearer only)"; fi
echo "Account:      $ACCOUNT_ID"
echo "Region:       $REGION"
echo "Distribution: $DISTRIBUTION_ID"
echo "Table:        $TABLE_NAME"
echo "Lambda:       $LAMBDA_NAME (role $LAMBDA_ROLE)"
echo "API path:     $API_PATTERN"
echo "Origin guard: $GUARD_DESC"
echo

# ---------- 1. DynamoDB table ----------
if aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "==> Table $TABLE_NAME already exists"
else
  echo "==> Creating DynamoDB table $TABLE_NAME (on-demand)"
  aws dynamodb create-table --table-name "$TABLE_NAME" --region "$REGION" \
    --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
    --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST >/dev/null
  aws dynamodb wait table-exists --table-name "$TABLE_NAME" --region "$REGION"
fi

# ---------- 2. IAM role ----------
if aws iam get-role --role-name "$LAMBDA_ROLE" >/dev/null 2>&1; then
  echo "==> Role $LAMBDA_ROLE already exists"
else
  echo "==> Creating role $LAMBDA_ROLE"
  TRUST="$(jq -n '{Version:"2012-10-17",Statement:[{Effect:"Allow",Principal:{Service:"lambda.amazonaws.com"},Action:"sts:AssumeRole"}]}')"
  aws iam create-role --role-name "$LAMBDA_ROLE" \
    --assume-role-policy-document "$TRUST" >/dev/null
  aws iam attach-role-policy --role-name "$LAMBDA_ROLE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole >/dev/null
  echo "    waiting for role to propagate…"; sleep 10
fi
echo "==> Putting inline DynamoDB policy on $LAMBDA_ROLE"
DDB_POLICY="$(jq -n --arg arn "$TABLE_ARN" '{Version:"2012-10-17",Statement:[{Effect:"Allow",Action:["dynamodb:Query","dynamodb:GetItem","dynamodb:PutItem","dynamodb:DeleteItem"],Resource:$arn}]}')"
aws iam put-role-policy --role-name "$LAMBDA_ROLE" \
  --policy-name darts-practice-ddb --policy-document "$DDB_POLICY" >/dev/null

# ---------- 3. Lambda function ----------
echo "==> Packaging function"
( cd "$SCRIPT_DIR/infra/lambda" && zip -q "$TMP/fn.zip" index.mjs )
ENV_VARS="Variables={TABLE_NAME=${TABLE_NAME},API_TOKEN=${API_TOKEN},ORIGIN_SECRET=${ORIGIN_SECRET}}"

if aws lambda get-function --function-name "$LAMBDA_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "==> Updating function code + config"
  aws lambda update-function-code --function-name "$LAMBDA_NAME" --region "$REGION" \
    --zip-file "fileb://$TMP/fn.zip" >/dev/null
  aws lambda wait function-updated-v2 --function-name "$LAMBDA_NAME" --region "$REGION"
  aws lambda update-function-configuration --function-name "$LAMBDA_NAME" --region "$REGION" \
    --runtime nodejs20.x --handler index.handler --timeout 10 --memory-size 128 \
    --environment "$ENV_VARS" >/dev/null
else
  echo "==> Creating function $LAMBDA_NAME"
  aws lambda create-function --function-name "$LAMBDA_NAME" --region "$REGION" \
    --runtime nodejs20.x --handler index.handler --role "$ROLE_ARN" \
    --timeout 10 --memory-size 128 --environment "$ENV_VARS" \
    --zip-file "fileb://$TMP/fn.zip" >/dev/null
fi
aws lambda wait function-active-v2 --function-name "$LAMBDA_NAME" --region "$REGION"

# ---------- 4. Function URL ----------
if aws lambda get-function-url-config --function-name "$LAMBDA_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "==> Function URL already configured"
else
  echo "==> Creating Function URL (auth NONE)"
  aws lambda create-function-url-config --function-name "$LAMBDA_NAME" --region "$REGION" \
    --auth-type NONE >/dev/null
fi
# Public-invoke permission (idempotent — ignore if it already exists).
aws lambda add-permission --function-name "$LAMBDA_NAME" --region "$REGION" \
  --statement-id FunctionURLPublicInvoke --action lambda:InvokeFunctionUrl \
  --principal "*" --function-url-auth-type NONE >/dev/null 2>&1 || true

FN_URL="$(aws lambda get-function-url-config --function-name "$LAMBDA_NAME" --region "$REGION" --query FunctionUrl --output text)"
FN_HOST="${FN_URL#https://}"; FN_HOST="${FN_HOST%/}"
echo "    function URL host: $FN_HOST"

# ---------- 5. CloudFront origin + ordered behavior ----------
echo "==> Fetching distribution config"
aws cloudfront get-distribution-config --id "$DISTRIBUTION_ID" > "$TMP/dist.json"
ETAG="$(jq -r '.ETag' "$TMP/dist.json")"
jq '.DistributionConfig' "$TMP/dist.json" > "$TMP/config.json"

HAVE_ORIGIN="$(jq --arg id "$ORIGIN_ID" 'any(.Origins.Items[]; .Id == $id)' "$TMP/config.json")"
HAVE_BEHAVIOR="$(jq --arg p "$API_PATTERN" '((.CacheBehaviors.Items // [])[] | select(.PathPattern == $p)) // empty | true' "$TMP/config.json")"

if [[ "$HAVE_ORIGIN" == "true" && "$HAVE_BEHAVIOR" == "true" ]]; then
  echo "==> Distribution already has the API origin + behavior — nothing to change."
else
  if [[ -n "$ORIGIN_SECRET" ]]; then
    CUSTOM_HEADERS="$(jq -n --arg v "$ORIGIN_SECRET" '{Quantity:1,Items:[{HeaderName:"X-Origin-Secret",HeaderValue:$v}]}')"
  else
    CUSTOM_HEADERS='{"Quantity":0}'
  fi
  ORIGIN_JSON="$(jq -n --arg id "$ORIGIN_ID" --arg domain "$FN_HOST" --argjson ch "$CUSTOM_HEADERS" '
    { Id:$id, DomainName:$domain, OriginPath:"",
      CustomHeaders:$ch,
      CustomOriginConfig:{ HTTPPort:80, HTTPSPort:443, OriginProtocolPolicy:"https-only",
        OriginSslProtocols:{Quantity:1,Items:["TLSv1.2"]},
        OriginReadTimeout:30, OriginKeepaliveTimeout:5 },
      ConnectionAttempts:3, ConnectionTimeout:10,
      OriginShield:{Enabled:false} }')"
  BEHAVIOR_JSON="$(jq -n --arg origin "$ORIGIN_ID" --arg pattern "$API_PATTERN" \
      --arg cp "$CACHING_DISABLED" --arg orp "$ALL_VIEWER_EXCEPT_HOST" '
    { PathPattern:$pattern, TargetOriginId:$origin,
      ViewerProtocolPolicy:"redirect-to-https",
      AllowedMethods:{ Quantity:7, Items:["GET","HEAD","OPTIONS","PUT","POST","PATCH","DELETE"],
        CachedMethods:{ Quantity:2, Items:["GET","HEAD"] } },
      Compress:true,
      CachePolicyId:$cp,
      OriginRequestPolicyId:$orp,
      FunctionAssociations:{Quantity:0},
      LambdaFunctionAssociations:{Quantity:0},
      FieldLevelEncryptionId:"", SmoothStreaming:false }')"

  # Add origin if missing; put the API behavior FIRST so it out-ranks /<prefix>/*.
  jq --argjson origin "$ORIGIN_JSON" --argjson behavior "$BEHAVIOR_JSON" \
     --arg originId "$ORIGIN_ID" --arg pattern "$API_PATTERN" '
    .Origins.Items |= (if any(.Id == $originId) then . else . + [$origin] end)
    | .Origins.Quantity = (.Origins.Items | length)
    | .CacheBehaviors = (.CacheBehaviors // {Quantity:0, Items:[]})
    | .CacheBehaviors.Items = ([ $behavior ] + ((.CacheBehaviors.Items // []) | map(select(.PathPattern != $pattern))))
    | .CacheBehaviors.Quantity = (.CacheBehaviors.Items | length)
  ' "$TMP/config.json" > "$TMP/config-new.json"

  echo "==> Planned change to distribution $DISTRIBUTION_ID:"
  [[ "$HAVE_ORIGIN" == "true" ]] || echo "    + origin '$ORIGIN_ID' -> $FN_HOST (https-only)"
  echo "    + ordered behavior '$API_PATTERN' -> '$ORIGIN_ID' (CachingDisabled, first in precedence)"

  if [[ "${APPLY:-}" != "1" ]]; then
    read -r -p "Apply to distribution $DISTRIBUTION_ID? [y/N] " ans
    [[ "$ans" == "y" || "$ans" == "Y" ]] || { echo "Aborted (set APPLY=1 to skip)."; exit 1; }
  fi
  echo "==> Updating distribution"
  aws cloudfront update-distribution --id "$DISTRIBUTION_ID" --if-match "$ETAG" \
    --distribution-config "file://$TMP/config-new.json" >/dev/null
fi

echo
echo "==> Backend ready."
echo "    API base (through CloudFront):  https://<your-domain>${API_PATTERN%\*}"
echo "    Open the app, go to the Log tab, paste your API_TOKEN once."
echo "    (CloudFront changes can take a few minutes to propagate.)"
