# Power-scoring backend

A minimal, single-user serverless backend that durably stores practice
sessions for the in-app **Log** view. Optional — the rest of the site is still
a pure static app. All analytics stay client-side (`scoring-stats.js`); the
backend is thin storage only.

## Shape

```
Browser (Log view)
   │  fetch  Authorization: Bearer <API_TOKEN>
   ▼
CloudFront  ──  behavior "/<prefix>/api/*"  (CachingDisabled, AllViewerExceptHostHeader)
   │            injects header  X-Origin-Secret: <ORIGIN_SECRET>
   ▼
Lambda Function URL  (Node 20, no bundled deps — AWS SDK from runtime)
   │            checks bearer token + origin secret
   ▼
DynamoDB table  (pk="me", sk=<id>)   on-demand billing
```

Why this shape: it reuses your existing CloudFront distribution (so the API is
same-origin — no CORS), needs no API Gateway, and costs ~nothing at personal
volume. The `X-Origin-Secret` header means the Function URL (auth NONE) can't be
usefully hit directly, bypassing CloudFront.

## API

All under `/<prefix>/api` (e.g. `/darts/api`). Auth on every request:
`Authorization: Bearer <API_TOKEN>` (+ the CloudFront origin secret).

| Method | Path             | Body                                   | Returns            |
|--------|------------------|----------------------------------------|--------------------|
| GET    | `/sessions`      | —                                      | `{ sessions: [] }` |
| POST   | `/sessions`      | `{date,type,target,darts,score,notes}` | `{ session }`      |
| PUT    | `/sessions/{id}` | same                                   | `{ session }`      |
| DELETE | `/sessions/{id}` | —                                      | `{ deleted }`      |

`type` ∈ `test | interleave | volume | technique`. Only `test` feeds the trend.

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

- **Auth is single-user and simple by design.** The bearer token is a shared
  secret behind HTTPS — right for a personal app, not multi-tenant. Rotate by
  changing `API_TOKEN` in `deploy.env` and re-running `backend.sh` (then
  re-paste it in the app).
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
