# Darts Count Practice

A static web app for practising darts counting and checkouts. It simulates an
opponent's three-dart throws and drills you on counting like a marker, plus a
checkout flashcard trainer and a reference chart.

- **Practice** — darts reveal one at a time so you sum the three-dart total in
  your head; near the finish it asks what's left after each dart. Optional
  suggested-finish hint.
- **Finishes** — flashcard trainer for memorising checkouts (self-graded).
- **Chart** — standard checkouts for 2–170.

It's 100% client-side (no backend; settings persist in `localStorage`).

## Local development

```sh
npm run dev          # serves ./public at http://localhost:3000
```

(Any static file server works, e.g. `python3 -m http.server -d public 3000`.)

## Hosting

Served as static files from a private **S3 bucket** behind an existing
**CloudFront** distribution. The app is attached under a path prefix
(`PATH_PATTERN`, e.g. `/darts/*`) so it coexists with anything else the
distribution already serves.

### Configure

Copy the example config and fill in your values (kept out of git):

```sh
cp deploy.env.example deploy.env
$EDITOR deploy.env        # BUCKET, REGION, DISTRIBUTION_ID, PATH_PATTERN
```

### Bootstrap the infrastructure (one-time, idempotent)

Creates the bucket + OAC + a CloudFront Function (resolves directory URIs to
`index.html`), then adds an origin and an **ordered** cache behavior to your
existing distribution and sets the bucket policy. It prints the planned change
and asks before modifying the distribution.

```sh
aws-vault exec <profile> -- ./bootstrap.sh
```

Requires `aws` CLI and `jq`.

### Deploy

Syncs `public/` to S3 (under the prefix) and invalidates CloudFront:

```sh
aws-vault exec <profile> -- ./deploy.sh
```

## Layout

```
public/            static site (deployed as-is)
  index.html
  css/styles.css
  js/{checkout,board,numpad,practice,trainer,app}.js
infra/index-rewrite.js   CloudFront Function source
bootstrap.sh       one-time infra setup
deploy.sh          sync + invalidate
deploy.env         your config (gitignored)
```
