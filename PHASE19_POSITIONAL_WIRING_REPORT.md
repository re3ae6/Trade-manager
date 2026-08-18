# Phase 19 — Positional Wiring Report

Date: 2026-08-18
Project: Trade Manager v2.10.0

## Objective

Remove the five index-based DOM button bindings identified by Audit finding #16 while preserving current behavior. The locked fix plan explicitly defines this as P3 cleanup: add dedicated selectors/IDs, remove index-based selection, and do not change behavior.

## Changes

### Long-term plan active view
Added IDs:
- `tpEditBtn`
- `tpCompleteBtn`
- `tpCancelBtn`

Replaced:
- `activeButtons[0]`
- `activeButtons[1]`
- `activeButtons[2]`

with direct ID bindings.

### Session history
Added IDs:
- `historyExportBtn`
- `historyClearBtn`

Replaced:
- `histButtons[0]`
- `histButtons[1]`

with direct ID bindings.

The long-term-plan create button was already targeted through `#tradingPlanCreateView` and was not part of the five positional bindings, so it was intentionally left unchanged.

## Versioning

`CACHE_VERSION`: `v2.10.16` → `v2.10.17`.

## Verification

- `npm run check`: PASS
- `npm test`: PASS — 84/84
- `node scripts/build-web.mjs`: PASS
- `index.html` ↔ `www/index.html`: synchronized
- `src/js/app.js` ↔ `www/src/js/app.js`: synchronized
- `service-worker.js` ↔ `www/service-worker.js`: synchronized

## Scope Guard

No trading logic, planner logic, Simple/Masaniello behavior, or UI decision rules were changed.

## Result

Phase 19 is complete.
