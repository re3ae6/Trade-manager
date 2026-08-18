# Phase 20 — CSP / Orphan-DOM Final Audit Report

Date: 2026-08-19
Project: Trade Manager v2.10.0

## Objective

Final cleanup/security verification for the two remaining findings identified in the ZIP review:

1. Complete CSP compatibility audit, including dynamically generated HTML.
2. Complete orphan/dead DOM reference audit, with special attention to `tpEditHint`.

## Baseline

Before changes:

- `npm run check`: PASS
- `npm test`: PASS — 84/84
- `node scripts/build-web.mjs`: PASS
- `CACHE_VERSION`: `v2.10.17`
- `src/` ↔ `www/`: synchronized for HTML, JS, CSS and service worker.

## Phase A — Repository / scope verification

Confirmed repository contains:

- `package.json`
- `index.html`
- `src/js/`
- `src/css/app.css`
- `www/`
- `service-worker.js`
- `tests/`
- `scripts/build-web.mjs`
- `PROJECT_CHANGELOG.md`
- `PHASE18_CSS_CLEANUP_REPORT.md`
- `PHASE19_POSITIONAL_WIRING_REPORT.md`
- audit/context documentation in `AI_CONTEXT.md` / `ai_context.md`

Phase 19 was reviewed. Its positional wiring changes are preserved unchanged.

## Phase B — CSP audit

Current policy remains:

`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';`

Resource audit:

- HTML module script: same-origin `src/js/app.js`
- CSS: same-origin `src/css/app.css`
- manifest: same-origin `manifest.json`
- apple touch icon: same-origin `icons/icon-192.png`
- no external HTTP(S) origins
- no `<iframe>`, `<object>`, `<embed>`
- no inline `<script>` or `<style>` blocks
- no inline event-handler attributes
- no static HTML `style=` attributes
- no `javascript:` or `blob:` URLs
- no `eval()` / `new Function()` in runtime source

### Finding

A strict CSP-compatible HTML generation issue remained in `src/js/app.js`:

- `renderHistory()` generated `style="text-align:center; padding:10px;"` inside an `innerHTML` template.
- This is an inline style attribute and is incompatible with the project's strict `style-src 'self'` policy.

### Fix

Replaced the inline style with the new `.empty-history-state` CSS class. No behavior or decision rule changed.

A regression test now scans `app.js` for dynamically generated inline style attributes and inline event handlers.

## Phase C — Orphan / dead DOM audit

`tpEditHint` was confirmed to have:

- no JavaScript consumer,
- no JavaScript producer,
- no CSS consumer,
- no ARIA reference,
- no dynamic creation path.

The changelog explicitly documented it as an orphan created by Phase 12's removal of the old planner-edit producer.

### Fix

Removed the empty `tpEditHint` element from both `index.html` and `www/index.html`.

A regression test now asserts that `tpEditHint` is absent from both the HTML and app source.

Other static IDs that appear unused by direct ID lookup were cross-checked against the app's `$()` shorthand, `getElementById`, selector usage, dynamic template IDs, generic disclosure selectors, and structural HTML/ARIA relationships. No additional confidently dead ID was removed in this phase.

## Scope Guard

No changes were made to:

- Simple
- Masaniello
- Planner
- Risk Engine
- Session logic
- trading calculations
- UI decision rules
- Phase 19 positional wiring behavior

Only CSP compatibility cleanup, dead DOM cleanup, regression tests, cache versioning, and generated web synchronization were changed.

## Version / verification

`CACHE_VERSION` bumped:

`v2.10.17` → `v2.10.18`

Final verification:

- `npm run check`: PASS
- `npm test`: PASS — 86/86
- `node scripts/build-web.mjs`: PASS
- `index.html` ↔ `www/index.html`: byte-identical
- `src/js/app.js` ↔ `www/src/js/app.js`: byte-identical
- `src/css/app.css` ↔ `www/src/css/app.css`: byte-identical
- `service-worker.js` ↔ `www/service-worker.js`: byte-identical
- residual `tpEditHint` runtime reference: none
- residual generated `style=` HTML attribute in app source: none

## Result

The two requested remaining ZIP-review findings are closed for this phase. No trading behavior was intentionally changed.
