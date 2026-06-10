# Power-scoring backend

A minimal, single-user serverless backend that durably stores practice
sessions for the in-app **Log** view. Optional — the rest of the site is still
a pure static app. All analytics stay client-side (`scoring-stats.js`); the
backend is thin storage only.

## Shape

```
Browser (Log view)
   │  fetch  X-Api-Key: <API_TOKEN>     (NOT Authorization — see below)
   ▼
CloudFront  ──  behavior "/<prefix>/api/*"  (CachingDisabled + a CUSTOM origin
   │            request policy: forwards X-Api-Key + query strings, NOT
   │            Authorization/Host — see below)
   │            OAC signs the request (SigV4) → sets the Authorization header
   │            also injects  X-Origin-Secret: <ORIGIN_SECRET>
   ▼
Lambda Function URL  (auth AWS_IAM; Node 20, no bundled deps — SDK from runtime)
   │            IAM validates the OAC signature; handler checks X-Api-Key (+ secret)
   ▼
DynamoDB table  (pk="me", sk=<id>)   on-demand billing
```

Why this shape: it reuses your existing CloudFront distribution (same-origin —
no CORS), needs no API Gateway, and costs ~nothing at personal volume.

**Why AWS_IAM + OAC, not a public (auth NONE) Function URL:** many AWS
Organizations apply an SCP/RCP that forbids anonymous (`principal: *`) Function
URL invocation — you get a persistent `AccessDeniedException` no matter how
correct the function's own policy is. With OAC, CloudFront SigV4-signs each
request, so the caller is the in-org `cloudfront.amazonaws.com` service
principal (scoped to your distribution), never anonymous.

**Why the user secret is `X-Api-Key`, not `Authorization`:** a Lambda Function
URL uses the `Authorization` header for its IAM signature, and OAC sets it. If a
client also sent `Authorization: Bearer …`, it would clobber the OAC signature
(`The request signature we calculated does not match …`). So the user secret
travels in `X-Api-Key`; no client should send `Authorization`. (`X-Origin-Secret`
is now redundant given the signature, but kept as harmless defence-in-depth.)

**Why a custom origin request policy (not `AllViewerExceptHostHeader`):** the
managed `AllViewerExceptHostHeader` forwards *every* viewer header except `Host`
— including `Authorization`. With OAC, forwarding `Authorization` breaks the
SigV4 signing and **every** request fails IAM auth (GET → `Forbidden`, POST →
`signature … does not match`), even when the client sends no `Authorization` at
all. `backend.sh` therefore creates a custom policy that forwards only
`X-Api-Key` plus all query strings, and neither `Authorization` nor `Host`.

## API

All under `/<prefix>/api` (e.g. `/darts/api`). Auth on every request:
`X-Api-Key: <API_TOKEN>` (CloudFront adds the OAC signature + origin secret).

| Method | Path             | Fields (query string)                  | Returns            |
|--------|------------------|----------------------------------------|--------------------|
| GET    | `/sessions`      | —                                      | `{ sessions: [] }` |
| POST   | `/sessions`      | `?date&type&target&darts&score&notes`  | `{ session }`      |
| PUT    | `/sessions/{id}` | same                                   | `{ session }`      |
| DELETE | `/sessions/{id}` | —                                      | `{ deleted }`      |

`type` ∈ `test | interleave | volume | technique`. Only `test` feeds the trend.

**Writes carry data in the query string, not a JSON body.** CloudFront OAC signs
the query string but *not* the request body, so a body would break the SigV4
signature on the IAM-auth Function URL. The Lambda reads fields from
`queryStringParameters` (and still accepts a JSON body for direct/uncached
testing). Payloads are tiny, so the URL-length limit is a non-issue.

## One-time setup

1. Fill in `deploy.env` (gitignored). Generate the secrets:
   ```sh
   openssl rand -hex 24   # -> API_TOKEN
   openssl rand -hex 24   # -> ORIGIN_SECRET
   ```
   Set `API_TOKEN`, `ORIGIN_SECRET`, and (optionally) `TABLE_NAME` /
   `LAMBDA_NAME` / `LAMBDA_ROLE`. `REGION`, `DISTRIBUTION_ID`, and `PATH_PATTERN`
   are the same values the static deploy already uses.

2. Provision (idempotent; prompts before mutating the distribution):
   ```sh
   aws-vault exec <profile> -- ./infra/backend.sh
   #   APPLY=1 aws-vault exec <profile> -- ./infra/backend.sh   # skip prompt
   ```
   This creates the DynamoDB table, the IAM role, the Lambda + Function URL, and
   adds a CloudFront origin + an **ordered** `/<prefix>/api/*` behavior placed
   *before* the app behavior so it wins precedence.

3. Deploy the static files as usual (`./deploy.sh`) — the new `Log` view, the
   manifest, and the icons ship with it.

4. Open the app → **Log** tab → paste `API_TOKEN` once (stored only in that
   browser's `localStorage`). Add it on each device you log from.

## Re-running / updating

`backend.sh` is idempotent. Re-run it to push new Lambda code (it updates the
function and skips the distribution change when the origin/behavior already
exist). Requires `aws`, `jq`, `zip`.

## Notes & caveats

- **Auth is single-user and simple by design.** The `X-Api-Key` secret is a
  shared secret, on top of the OAC signature that proves the request came from
  your distribution — right for a personal app, not multi-tenant. Rotate by
  changing `API_TOKEN` in `deploy.env` and re-running `backend.sh` (then
  re-paste it in the app).
- **Don't send an `Authorization` header to the API** from any client — OAC
  reserves it for the SigV4 signature, and a stray one causes
  `The request signature we calculated does not match …`. Use `X-Api-Key`.
- **DynamoDB is the single source of truth** for sessions. Enter everything via
  the app's Log tab. (The progress math lives in `public/js/scoring-stats.js`,
  which the Log view uses and which has a Node export shim for unit tests.)
- **`.webmanifest` content-type:** `aws s3 sync` may upload it as
  `application/octet-stream`. Browsers still honor the `apple-touch-icon` +
  Apple meta tags for iOS home-screen install, so this is cosmetic. If you want
  the manifest served correctly, re-put it with
  `--content-type application/manifest+json`.
- **Cost:** DynamoDB on-demand + Lambda + a trickle of CloudFront requests —
  effectively free at one user logging a few sessions a day.

## Local verification

The pure logic is testable without AWS: the `scoring-stats.js` math (Node export
shim) and the Lambda's router/auth/validation (exported helpers in `index.mjs`,
which dynamic-imports the AWS SDK only inside the handler). The Log view itself
is exercised via headless Chrome over CDP against a mocked backend — see
`CLAUDE.md` "Verifying changes".
