# Phase 21 — Simple Risk Cards & Landscape Grid Fix

## Scope

This phase fixes two verified CSS/UI layout regressions only:

1. Simple-mode risk recommendation cards were hidden by an overriding CSS rule.
2. Landscape layout had four relevant grid children but only three explicit grid columns, causing the long-term plan column to flow into a second row/overlap layout.

No trading logic, calculation engine, decision rule, session logic, risk engine, Simple engine, Masaniello engine, Planner logic, Recovery logic, or PWA behavior was changed.

## Fixes

### 1. Simple risk cards

Removed the rule:

```css
#panelSimple .simple-planner-block{display:none}
```

The existing risk recommendation cards are now allowed to render in Simple mode.

### 2. Landscape grid

The landscape grid now explicitly provides four columns:

- Trade
- Plan
- Performance
- Long-term

The long-term `.calc-column[data-section-panel="longterm"]` is explicitly assigned to column 4.

This avoids implicit row creation and removes the overlap/zero-height behavior observed at approximately 915×412.

## Cache

`CACHE_VERSION` bumped:

`v2.10.18` → `v2.10.19`

## Verification

Baseline before this phase:

- `npm run check` — PASS
- `npm test` — 87/87 PASS
- `node scripts/build-web.mjs` — PASS

After changes:

- `npm run check` — PASS
- `npm test` — 87/87 PASS
- `node scripts/build-web.mjs` — PASS
- source/`www` files synchronized

A Playwright package is not installed in this ZIP environment, so the final verification here is static CSS regression coverage plus the full Node test/build suite; the reported 915×412 runtime finding was independently fixed by explicit four-column placement rather than relying on implicit grid flow.
