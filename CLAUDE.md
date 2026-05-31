# CLAUDE.md

Guidance for working in this repo. See `README.md` for the user-facing overview.

## What this is

A **static, client-side** darts counting/checkout practice app. No backend, no
database, no API calls — all state lives in the browser (`localStorage`). It is
served as static files from S3 behind an existing CloudFront distribution.

## Architecture — read before editing

- **No build step, no framework, no dependencies.** `public/` is shipped as-is.
  JS files are plain `<script>` tags loaded in a fixed order in `index.html`:
  `checkout.js → board.js → numpad.js → practice.js → trainer.js → app.js`.
  Keep this order; `app.js` must load last (it boots everything on
  `DOMContentLoaded`).
- **Module pattern:** each JS file is an IIFE that attaches one global object
  (`window.Checkout`, `Board`, `Numpad`, `Practice`, `Trainer`, `Settings`).
  No imports/exports. `checkout.js` also has a Node `module.exports` shim purely
  so it can be unit-tested from the CLI.
- **Three views** (`#view-practice`, `#view-trainer`, `#view-chart`) switched by
  the header tabs. `app.js` owns routing and a single global `keydown` bus that
  forwards to the active view's controller.
- **View-controller interface:** `Practice` and `Trainer` each expose
  `{ init, onActivate, onDeactivate, onKey }`. `app.js` calls these on tab
  switch. Follow this shape if you add a view.

## Key invariants (don't break these)

- **`Checkout.getRoute(score)` is the single source of truth** for checkouts. The
  Practice finish hint, the Trainer, and the Chart all derive from it — never
  hard-code or duplicate checkout routes elsewhere. It returns an array of dart
  objects (or `null` for bogey numbers 159/162/163/165/166/168/169 and
  out-of-range). After changing the solver, re-run the validation snippet below.
- **Input goes through one path.** The on-screen `Numpad` and the hardware
  keyboard both call the same `onDigit/onBackspace/onEnter` handlers in
  `practice.js`. Don't add a parallel input route.
- **Practice is a phase state machine** (`phase`: `reveal → round → remaining →
  answered`, plus a separate finishing flow). `mode` is `normal` (>170,
  sequential reveal) or `finishing` (≤170, one dart at a time). The
  `autoAdvancing` flag prevents a double `nextTurn()` when a correct answer
  auto-advances and the user also presses Enter — keep it.
- **Canvas sizing:** `board.js` draws in a fixed 500×500 logical space and scales
  the context to the CSS box (incl. `devicePixelRatio`). `clientWidth` is 0 while
  hidden, so `Board.resize()` must be called *after* the stage becomes visible
  (it is, in `startGame` and `onActivate`). If you add new entry points, do the
  same or the board renders at the 320px fallback size.
- **`body.playing` class** is toggled by `practice.js` (added on start; removed on
  new-game and on checkout). CSS uses it only at `max-width: 919px` to hide the
  header during a leg. Removing it brings the header/nav back.

## CSS

- Mobile-first. Base rules target phones; desktop is layered on at
  `@media (min-width: 920px)`. The play stage is a CSS **grid** with named areas
  (`top / board / answer / fb / pad / over / panel`) — the same area names are
  reused in both breakpoints, only the template changes. If you add/move a stage
  element, give it a grid-area in both templates.
- Theme via CSS variables in `:root` (`--accent` `#e94560`, dark `#1a1a2e`).

## Verifying changes

There are no automated tests; verify directly.

- **Checkout solver** (pure, Node-testable):
  ```sh
  node -e 'const C=require("./public/js/checkout.js");
    let bad=0; for(let s=2;s<=170;s++){const r=C.getRoute(s); if(!r)continue;
      const sum=r.reduce((a,d)=>a+d.value,0), last=r[r.length-1];
      if(!(sum===s && r.length<=3 && (last.ring==="double"||last.ring==="bull")))bad++;}
    console.log("invalid routes:", bad);'
  ```
- **UI / gameplay**: serve locally (`npm run dev`) and drive it. The controllers
  are DOM-heavy, so for end-to-end checks drive **system headless Chrome over
  CDP**:
  - Chrome path: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
  - Launch with `--headless=new --remote-debugging-port=PORT --user-data-dir=...`
  - Client: `npm install chrome-remote-interface` in a throwaway temp dir (do NOT
    add it to this project's deps). Drive the numpad by dispatching
    `pointerdown` on `.np-*` buttons; read state from `#inputPrompt`,
    `#dartSlots li`, `#scoreRemaining`. Always check `Runtime.exceptionThrown`
    for zero page errors. Emulate a ~390×760 viewport for mobile checks.
  - Clean up the temp dir, Chrome profile, and any background `serve`/Chrome
    processes afterward.

## Deploy & infra

- Config lives in **`deploy.env` (gitignored)** — `BUCKET`, `REGION`,
  `DISTRIBUTION_ID`, `PATH_PATTERN` (e.g. `/darts/*`). `deploy.env.example` is the
  committed template.
- **This GitHub repo is public.** Never commit the bucket name, distribution ID,
  or account ID. Keep them in `deploy.env` only.
- `bootstrap.sh` (one-time, idempotent): creates the private bucket + OAC + the
  `infra/index-rewrite.js` CloudFront Function, then **additively** adds an S3
  origin and an *ordered* cache behavior for `PATH_PATTERN` to the existing
  distribution, and sets the bucket policy. With a non-empty `PATH_PATTERN` it
  does **not** touch the distribution's default behavior. It prints the plan and
  prompts before mutating the distribution (`APPLY=1` skips the prompt). When
  editing the jq that rewrites the distribution config, test it against a
  synthetic `get-distribution-config` output first — a bad transform can break
  the live distribution.
- `deploy.sh`: `aws s3 sync public/ → s3://$BUCKET/<prefix>` (`--delete`,
  short cache), re-uploads `index.html` as `no-cache`, then invalidates
  `/<prefix>/*`. Files are not content-hashed, so freshness relies on that
  invalidation.
- Both scripts source `deploy.env` and are run as
  `aws-vault exec <profile> -- ./<script>.sh`. They need `aws` and `jq`.

## Conventions

- Match the existing terse, comment-light-but-purposeful style. Plain ES (no TS,
  no modules), 2-space indent.
- Don't introduce a build tool, bundler, or runtime dependency without a strong
  reason — the zero-build static deploy is a feature.
- Commit/push only when the user asks.
