# Trade Manager v2.10.0 — Phase 18 CSS Cleanup

## Scope
Phase 18 — P3 CSS Cleanup, based on `TRADE_MANAGER_AUDIT_LOCKED_FIX_PLAN-v2_10_0.md`.

## Changes
- Removed the dead `z-index:1000` from the earlier `.modal-backdrop` rule; the authoritative later rule keeps `z-index:9999`.
- Removed the dead earlier `.appdialog` `overflow:hidden`; the later authoritative rule keeps `overflow:auto`.
- Removed overridden `.appdialog-body` font-size/line-height; the later mobile/authority rule remains authoritative.
- Removed overridden `.appdialog-actions` gap declaration; the later rule keeps `gap:6px`.
- Removed overridden `.dialog-alt` min-height/padding; the later shared dialog-button rule remains authoritative.
- Removed the fully overridden early `.btn-analyze` rule; the later `.btn-analyze` rules remain authoritative.
- Removed the redundant `.small` color declaration; the later accessibility polish declaration provides the same resolved color.
- Removed redundant `max-width`/`margin` declarations from the later `.app` rule; the original `.app` rule remains the authority for those values while the later rule retains only additive mobile viewport properties.
- Bumped `CACHE_VERSION` from `v2.10.15` to `v2.10.16` as required whenever `src/css` changes.
- Rebuilt `www/`; `src/css/app.css` and `www/src/css/app.css` are byte-identical after the build.

## Verification
- `npm run check`: PASS
- `npm test`: 83/84 PASS.
- The single failure is an existing hard-coded assertion in `tests/core.test.mjs` expecting `CACHE_VERSION = 'v2.10.15'`. The project rule requires bumping the cache version after CSS changes, so the implementation correctly uses `v2.10.16`. The test file was not modified because the Phase 18 rules specify editing only `src/` (with the required service-worker cache-version bump).
- `node scripts/build-web.mjs`: PASS
- `src/css/app.css` ↔ `www/src/css/app.css`: PASS (byte-identical)
- `service-worker.js` ↔ `www/service-worker.js`: both use `v2.10.16`

## No changes
No trading logic, JavaScript application logic, HTML, or product decisions were changed.
