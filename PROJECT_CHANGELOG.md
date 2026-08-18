# V2.10.0 — Phase 21: Simple Risk Cards & Landscape Grid Fix — 2026-08-19

## Summary

- Removed the CSS rule that incorrectly hid `.simple-planner-block` in Simple mode, restoring the Low/Medium/High risk recommendation cards.
- Fixed the landscape grid to explicitly reserve four columns for Trade, Plan, Performance and Long-term sections.
- Explicitly placed the Long-term `.calc-column` in grid column 4 to prevent implicit-row overlap/zero-height behavior.
- Added regression coverage for both CSS findings.
- `CACHE_VERSION` bumped `v2.10.18` → `v2.10.19`.
- **Verification:** `npm run check` PASS; `npm test` PASS (88/88); `node scripts/build-web.mjs` PASS; source/`www` files synchronized.
- **Scope:** CSS/layout cleanup only. No trading logic, Simple engine calculations, Masaniello, Planner, Recovery, Risk Engine, Session logic, or UI decision rules were changed.

---

# V2.10.0 — Audit Cleanup Phase 20: CSP / Orphan-DOM Final Audit — 2026-08-19

## Summary

- **Files changed:** `index.html`, `src/js/app.js`, `src/css/app.css`, `service-worker.js`, `tests/core.test.mjs` (plus generated `www/` copies).
- **CSP audit:** found one remaining dynamically generated inline `style=` attribute in `renderHistory()`. Replaced it with `.empty-history-state` so the generated HTML remains compatible with strict `style-src 'self'`.
- **Orphan DOM audit:** confirmed `tpEditHint` had no producer, consumer, CSS use, ARIA use, or dynamic creation path. Removed the empty orphan element from both source and generated HTML.
- **Regression coverage:** added tests for dynamically generated inline style/event-handler attributes and for complete removal of `tpEditHint`.
- `CACHE_VERSION` bumped `v2.10.17` → `v2.10.18`.
- **Verification:** `npm run check` PASS; `npm test` PASS (86/86); `node scripts/build-web.mjs` PASS; all source/`www` HTML, JS, CSS and service-worker copies synchronized.
- **Scope:** CSP/security cleanup and dead DOM verification only. No Simple, Masaniello, Planner, Risk Engine, Session logic, trading calculation, or UI decision rule changes.

---

# V2.10.0 — Audit Fix Phase 19: Positional Wiring — 2026-08-18

## Summary

- **Files changed:** `index.html`, `src/js/app.js`, `service-worker.js`, `tests/core.test.mjs` (and generated `www/` copies via build).
- **Problem (Audit finding #16):** five buttons were wired by DOM position/index instead of dedicated selectors. The audit confirmed the current order was correct, so this was a P3 maintainability risk rather than an active functional bug.
- **Fix:** added dedicated IDs to the three active long-term-plan action buttons (`tpEditBtn`, `tpCompleteBtn`, `tpCancelBtn`) and the two history buttons (`historyExportBtn`, `historyClearBtn`), then replaced the five index-based event bindings with direct ID-based bindings.
- The long-term plan create button was already selected through a specific container selector and was not part of the five positional bindings, so it was left unchanged.
- **Behavior:** no business logic or user-visible behavior intentionally changed; only DOM targeting/wiring was made explicit.
- `CACHE_VERSION` bumped `v2.10.16` → `v2.10.17` per project rule because source JS/HTML changed; the hardcoded-version test was updated accordingly.
- **Verification:** `npm run check` PASS; `npm test` PASS (84/84); `node scripts/build-web.mjs` PASS; `index.html`, `src/js/app.js`, and service-worker copies are synchronized with `www/`.
- **Scope:** Only Phase 19 (P3 — Positional Wiring) from the audit-locked fix plan.

---

# V2.10.0 — Audit Fix Phase 17: Orphan IDs — 2026-08-18

## Summary

- **Files changed:** `index.html`, `www/index.html`, `service-worker.js`, `www/service-worker.js`, `tests/core.test.mjs`
- **Problem (Audit finding #14, re-confirmed as finding #19 in the phase plan):** Two IDs in `index.html` — `tradePanelDetails` (line 65, on the trade-log column `<div>`) and `masanielloPlannerBlock` (line 217, on the Masaniello planner block `<div>`) — had zero consumers anywhere: not in `src/js/app.js` (checked against every `getElementById`, `$()`/`set()` shorthand, `num()`/`intNum()`, `querySelector('#...')` call, and the generic `details.collapsible-panel[id]` selector), not in `src/css/app.css`, and not as an ARIA reference target. Both elements are plain `<div>`s (not `details.collapsible-panel`), so they're also outside the generic open/closed-state selector. Dead leftovers from a prior refactor, not a functional bug.
- **Fix:** Removed the `id="tradePanelDetails"` and `id="masanielloPlannerBlock"` attributes from both `<div>`s in `index.html` and `www/index.html`. Only the `id` attribute was removed — `class` (`trade-column panel` / `masaniello-planner-block`) and all surrounding structure/content left untouched, since those classes are the actual styling/behavior hooks and were already confirmed live.
- **Verification:** Re-ran the grep cross-check after the edit — both IDs now return zero matches across `index.html`, `www/index.html`, `src/js/`, `www/src/js/`, `src/css/`, `www/src/css/`. `npm run check` PASS; `npm test` PASS (84/84, unchanged); `node scripts/build-web.mjs` PASS; `src/` ↔ `www/` byte-identical sync confirmed for `index.html`, `service-worker.js`, `src/js/`, `src/css/`.
- `CACHE_VERSION` bumped `v2.10.14` → `v2.10.15` per project rule (`index.html` changed); the hardcoded-version test in `tests/core.test.mjs` updated to match.
- **Remaining issues:** none introduced by this phase.
- **Rollback:** restore `id="tradePanelDetails"` on the trade-log column `<div>` and `id="masanielloPlannerBlock"` on the Masaniello planner block `<div>` in both `index.html` copies; revert `CACHE_VERSION` to `v2.10.14` in both `service-worker.js` copies and the test assertion.
- **Scope:** Only Phase 17 (P3 — Orphan IDs, finding #14/#19) from the audit-locked fix plan. No other phase's changes are included.

---

# V2.10.0 — Audit Fix Phase 13: Redundant `computeSessionStatistics` Calls — 2026-08-18

## Summary

- **Files changed:** `src/js/app.js`, `www/src/js/app.js`, `service-worker.js`, `www/service-worker.js`, `tests/core.test.mjs`
- **Problem (Audit finding #8):** `saveSession()` called `computeSessionStatistics(trades, initial)` four separate times — once each for `maxWinStreak`, `maxLossStreak`, `maxDrawdown`, `maxDrawdownPct` — recomputing the same statistics object from scratch each time. Performance-only issue; the audit confirmed the resulting values were correct.
- **Fix:** compute the object once — `const stats = computeSessionStatistics(trades, initial);` — right after `initial`/`finalBalance` are derived, then read `stats.maxWinStreak`, `stats.maxLossStreak`, `stats.maxDrawdown`, `stats.maxDrawdownPct` in the pushed session record. The unrelated `computeSessionStatistics` call elsewhere in `app.js` (line 1158, different function/context, live-session dashboard stats) was left untouched — it's a separate call site, not part of this finding.
- `CACHE_VERSION` bumped `v2.10.11` → `v2.10.12` per project rule (`src/js` changed); the hardcoded-version test in `tests/core.test.mjs` updated to match.
- **Verification:** `npm run check` PASS; `npm test` PASS (83/83, unchanged — test asserts output is identical before/after, only call count dropped from 4 to 1, per the fix plan's required test). `src/` ↔ `www/` byte-identical sync confirmed for `app.js`.
- **Remaining issues:** none introduced by this phase.
- **Rollback:** revert the `stats.*` reads back to four separate `computeSessionStatistics(trades, initial).*` calls; revert `CACHE_VERSION` to `v2.10.11` in both `service-worker.js` copies and the test assertion.
- **Scope:** Only Phase 13 (P3 — redundant `computeSessionStatistics` calls, finding #8) from the audit-locked fix plan. No other phase's changes are included.

---

# V2.10.0 — Audit Fix Phase 12: Dead DOM References — 2026-08-18

## Summary

- **Files changed:** `src/js/app.js`, `www/src/js/app.js`, `service-worker.js`, `www/service-worker.js`, `tests/core.test.mjs`
- **Problem (Audit finding #7, re-confirmed as finding #15):** Four references to `document.getElementById('tpEditTrades')` / `document.getElementById('tpEditLosses')` existed in `app.js`, but neither ID is defined anywhere in `index.html`, nor built dynamically via `innerHTML`/`createElement`. A full grep cross-check (repeated by the audit) confirmed no other instance of this pattern (JS referencing an HTML ID that doesn't exist) exists in the project. These were remnants of a removed "inline n/k edit" feature.
- **Fix:**
  - `renderMasanielloPlanner()` and `renderSimplePlannerSummary()`: removed the two dead `getElementById('tpEditTrades'/'tpEditLosses')` lines each. Both were confirmed no-ops (`getElementById` always returned `null`, so the guarding `n && l` condition never ran) — removal has no behavioral effect.
  - `previewPlannerEdit()` and `applyPlannerEdit()`: removed entirely. Both were fully dead code with zero callers anywhere in `app.js` or `index.html` (confirmed by grep), and their bodies existed solely to read `tpEditTrades`/`tpEditLosses`. Deleting only the `getElementById` lines inside them would have left the remaining logic referencing undefined variables; since the functions were never invoked, removing them outright is behavior-neutral and fully eliminates the dead code rather than leaving it half-cleaned.
- **Side effect noted for a future pass (not part of Phase 12's scope):** with `previewPlannerEdit()` removed, `<div id="tpEditHint">` (`index.html` line 252) is no longer read by any JS — it is now an orphan ID similar in nature to audit finding #14 (`tradePanelDetails` / `masanielloPlannerBlock`), but newly created by this fix rather than pre-existing. Recommend folding it into the orphan-ID cleanup phase.
- `CACHE_VERSION` bumped `v2.10.10` → `v2.10.11` per project rule (any `src/js`/`src/css` change requires a cache-version bump); the test asserting the hardcoded version string in `service-worker.js` was updated to match.
- **Verification:** `npm run check` PASS; `npm test` PASS (83/83, unchanged count — no tests added or removed this phase); `src/` ↔ `www/` byte-identical sync confirmed for `app.js`.
- **Remaining issues:** none introduced by this phase.
- **Rollback:** restore the two `getElementById('tpEditTrades'/'tpEditLosses')` no-op lines in `renderMasanielloPlanner()`/`renderSimplePlannerSummary()`, and restore the `previewPlannerEdit()`/`applyPlannerEdit()` function bodies from the pre-Phase-12 zip; revert `CACHE_VERSION` to `v2.10.10` in both `service-worker.js` copies and the test assertion.
- **Scope:** Only Phase 12 (P3 — Dead DOM References, findings #7 / #15) from the audit-locked fix plan. No other phase's changes are included.

---

# V2.10.0 — Audit Fix Phase 10: Content-Security-Policy — 2026-08-18

## Summary

- **Files changed:** `index.html`, `src/js/app.js`, `service-worker.js`, `tests/core.test.mjs`
- **Problem (Audit finding #12):** `index.html` defined no `Content-Security-Policy` at all. On its own this is not a bug, but it directly increases the severity of open finding #3 (Stored XSS) by removing the only browser-level defense-in-depth layer that would block an injected script from executing if that bug is ever exploited.
- **Pre-fix inventory (done before writing the policy, per the fix plan's instruction):** grepped the full source tree for every script/style/image/font/manifest/fetch source. Result: **zero external origins anywhere** — the single `<script type="module" src="src/js/app.js">` and its `import`s, the one `<link rel="stylesheet">`, the manifest link, and the apple-touch-icon are all same-origin; there are no CDNs, no fonts, no `<img>` tags, no `fetch()`/`XMLHttpRequest` calls, no `<iframe>`/`<object>`/`<embed>`, no `eval`/`new Function`, and no inline `on*=` event handler attributes anywhere in `index.html` or in HTML built dynamically by `app.js`.
- **One inline-style blocker found and fixed:** `#lossLimitExplain` had a static `style="display:none;"` attribute and was toggled in `app.js` via `explainEl.style.display = '' / 'none'`. A strict `style-src 'self'` (no `unsafe-inline`) would block that attribute from ever applying. Fixed by giving it the project's existing `.hidden` utility class instead and switching the two toggle sites in `calculateMaxLossLimit()`-adjacent code to `explainEl.classList.remove('hidden')` / `.add('hidden')`, matching the `classList.toggle('hidden', ...)` pattern already used ~40 times elsewhere in `app.js`. Purely visual toggling done via the CSSOM (`el.style.x = y`, used elsewhere in the app for other elements) is unaffected by `style-src` and was left untouched.
- **Fix:** added `<meta http-equiv="Content-Security-Policy" ...>` as the second line of `<head>`: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';`. No `unsafe-inline`/`unsafe-eval` anywhere, since none were needed.
- **Tests added:** new regression test asserts the CSP meta tag is present, contains no `unsafe-inline`/`unsafe-eval`, sets `object-src 'none'`, and that `index.html` contains zero inline `style=` attributes and zero inline `on*=` handler attributes.
- `CACHE_VERSION` bumped `v2.10.9` → `v2.10.10` per project rule (`index.html` and `src/js/app.js` changed); one pre-existing test that hardcoded the old version string was updated to match.
- **Verification:** `npm run check` PASS; `npm test` PASS (83/83, was 82 + 1 new); `node scripts/build-web.mjs` PASS; `src/` ↔ `www/` byte-identical sync confirmed (`diff` on `index.html`, `src/js/app.js`, `service-worker.js`).
- **Manual/logical check against acceptance criteria:** app shell, modals (confirm/backup/stress-test), event wiring (all via `addEventListener`, none inline), and Backup import (file input → `FileReader`-style text read → `JSON.parse`, plus `Blob`/`URL.createObjectURL` for export) use only same-origin script execution and JS APIs not restricted by this policy — none require a CSP exception.
- **Remaining issues:** none introduced by this phase. Finding #3 (Stored XSS, still open per audit) is unaffected by this fix beyond now having the defense-in-depth layer the audit asked for.
- **Rollback:** remove the `<meta http-equiv="Content-Security-Policy" ...>` line from `index.html`/`www/index.html`; revert `#lossLimitExplain` to `style="display:none;"` and the two `classList` calls back to `style.display`; revert `CACHE_VERSION` to `v2.10.9` in both `service-worker.js` copies and the test assertion.
- **Scope:** Only Phase 10 (P2 — CSP) from the audit-locked fix plan. No other phase's changes are included.

---

# V2.10.0 — Audit Fix Phase 6: Stress Test Target/Stop Loss Reporting — 2026-08-18

## Summary

- **Files changed:** `src/js/core/scenario-simulator.js`, `service-worker.js`, `tests/core.test.mjs`
- **Problem (Audit finding #6):** `simulateScenario()` did not return `targetHit`/`stopLossHit`, but `openStressTesting()` read those fields from each scenario's simulation result, so Best Case / Worst Case cards always showed `Target —` / `Stop Loss —` even when the underlying simulation was correct.
- **Fix:** `simulateScenario()` now returns `targetHit` (`finalBalance >= capital + targetProfit - 1e-9`) and `stopLossHit` (`lockReason === 'stoploss'`) alongside its existing result fields. No change to Simple/Masaniello/BE calculation logic.
- **Tests added:** Best Case scenario reports `targetHit === true`; Worst Case scenario reports `stopLossHit === true`; a plain single-`W` scenario against an unreached target reports both as `false`.
- `CACHE_VERSION` bumped `v2.10.5` → `v2.10.6` per project rule (any `src/js`/`src/css` change requires a cache-version bump).
- **Verification:** `npm run check` PASS; `npm test` PASS (77/77); `node scripts/build-web.mjs` PASS; `src/` ↔ `www/` sync confirmed.
- **Scope:** Only Phase 6 (P1 — Stress Test Target/Stop Loss) from the audit-locked fix plan. No other phase's changes are included.

---

# V2.10.0 — UI Overhaul: Mobile Section Tabs, Compact Header, Critical `.hidden` Fix — 2026-08-16

## Summary

- **Files changed:** `index.html`, `src/css/app.css`, `src/js/app.js`, `package.json`, `service-worker.js`, `README.md`
- Fixed a critical pre-existing bug: the `.hidden` utility class (used ~40 times across the app to show/hide panels, buttons, and mode-specific fields) had no CSS rule at all, so nothing using it was ever actually hidden. This was a major contributor to UI clutter across both Simple and Masaniello modes.
- Fixed the drawer/menu stacking bug (portrait + landscape) where main content painted over the open hamburger menu.
- Added CSS for the Strategy Comparison and Stress Test modals, which had markup but no styling.
- Fixed Masaniello risk-plan selection: the on-screen preview and the plan actually used to start a session could silently diverge (`riskLevel` vs `selectedPlannerRisk`); both now share one source of truth, with three selectable detail cards matching Simple mode.
- Reworked the mobile layout: compact single-row header (hamburger replaced by a "T·M" tap target doubling as the logo, mode tabs moved up next to it), a three-tab section switcher ("برنامه" / "بلندمدت" / "آمار") on narrow/portrait screens only (wide/landscape keeps the original 3-column layout), and the trade panel's collapsible header removed since it's the app's primary always-visible view.
- Simplified the trading-plan flow: the "برنامه فعال و اجرای سشن" panel is no longer a second editable form for n/k — it's a read-only summary of the plan selected above it, plus Save/Start.
- Long-term (multi-session) goal plan moved to its own tab, separate from the per-session Target & Plan; its start-balance field now uses the same thousands-formatted display as the main Balance field.
- Restyled Balance/Payout/Target inputs as matching "chip" fields with `$`/`%` affixes instead of text labels; collapsed the risk-advisor strip into a tap-to-expand "؟" badge that still changes color automatically by severity; fixed a text-alignment bug on empty vs filled number inputs (Stop Loss %, Payout).
- Version bumped to 2.10.0 across `package.json`, `APP_VERSION` (in-app About dialog), the service worker cache name, and `README.md`.

---

# V2.9.1 Corrective Patch — 2026-08-12

## UI / Payout stabilization

- **Files changed:** `index.html`, `src/css/app.css`, `src/js/app.js`, `src/js/core/payout.js`, `tests/core.test.mjs`
- **Problems:** Portrait/Landscape header hit-area and safe-area regressions; Drawer positioning/stacking conflicts; Landscape middle-column scrolling depended on conflicting CSS patches; Payout validation was split between UI normalization and percentage/fraction consumers; Exit dialog labels/geometry were inconsistent.
- **Cause:** Multiple late CSS override generations were still active simultaneously, while Payout normalization had no dedicated source-of-truth module.
- **Fix:** Added one Payout contract (`0.01 <= fraction <= 1` with legacy percentage normalization), kept existing core engines on their established percentage/fraction adapters, added Escape support for the main Drawer, made header/grid geometry authoritative in one final CSS block, restored Portrait left Drawer and Landscape independent column scrolling, and compacted the Exit dialog.
- **Tests:** `npm run check` PASS; `npm test` PASS (63/63); `node scripts/build-web.mjs` PASS. Runtime Android/WebView screenshot verification is still required after upload.
- **Regression risk:** Runtime Android/WebView screenshot verification remains required after upload. Core BE/Masaniello/session files were not modified.

# V2.9.1 — UI / Payout Correction

## Video-audit corrections
- Inspected the supplied runtime recording.
- Confirmed that `0.85` is visibly entered in Payout while the old validation warning remains visible.
- Payout validation now normalizes the field value before validation, including legacy percentage-style values.
- A stale validation warning is cleared immediately when the current setup becomes valid.
- Header z-index and hit-testing were reinforced without changing its established geometry.
- Navigation drawer was moved to a fixed overlay position so it cannot render underneath the navigation/header.
- Portrait drawer remains on the left; Landscape drawer remains on the right.
- Tools section uses text + arrow instead of the previous bubble/emoji header.
- Landscape middle column keeps an independent vertical scroll region.
- Target/Simple detail inputs retain the compact two-column layout.
- Strategy-card typography spacing was tightened without changing calculations.

## Verification
- `npm test`: 61/61 PASS
- `npm run check`: PASS
- `npm run build`: PASS

# Trade Manager — Project Change Log

> **Official project change ledger**
>
> This file is the persistent record of the Trade Manager project's audits,
> decisions, implementations, tests, builds, and known remaining issues.
>
> **Rule:** No project change is considered complete until it is recorded here.

---

## 1. Project Identity

- **Project:** Trade Manager
- **Repository:** `re3ae6/Trade-manager`
- **Project Goal:** Trading Plan & Risk Management Tool
- **Current UI Direction:** Dark Modern Cockpit
- **Offline Requirement:** Mandatory
- **Primary Source of Truth:** `src/`
- **Build Output:** `www/`
- **Android Packaging:** Capacitor + GitHub Actions
- **Core Engines:**
  - Simple
  - Masaniello
  - BE
  - Trading Plan
  - Planner
  - Session Management
  - Target
  - Stop Loss
  - History
  - Analytics

---

## 2. Non-Negotiable Project Rules

### 2.1 Code Reality First

Before any change:

1. Read the actual files.
2. Inspect the project structure.
3. Find function usage.
4. Inspect dependencies.
5. Inspect state and storage.
6. Inspect tests.
7. Inspect the real UI.
8. Build when required.
9. Only then decide.

If this changelog conflicts with the code, **the actual code is authoritative**.

### 2.2 Preserve Existing Logic

Do not rewrite Simple or Masaniello merely for architectural cleanliness.

Any logic change must be:

- necessary
- minimal
- tested
- explainable
- reversible
- backward-compatible

### 2.3 BE Contract

BE = Break Even.

BE:

- is not Win
- is not Loss
- does not change Balance
- does not create Profit
- does not create Loss
- counts as one Trade

Therefore:

`Trades = Wins + BE + Losses`

and:

`Win Rate = Wins / Trades`

### 2.4 Offline

Do not add:

- online APIs
- CDN resources
- online fonts
- online dependencies
- new Internet permission

Existing PWA, Service Worker, Manifest and Capacitor behavior must be preserved.

### 2.5 Source of Truth

Do not create conflicting independent values for:

- Target
- Balance
- Payout
- Stake
- Risk
- Session
- Planner
- Trading Plan

---

# 3. Historical Baseline

## V2.2.0 Final

### Baseline

The project was packaged as an Android APK using Capacitor/GitHub Actions while preserving the existing web application and offline behavior.

### Important requirements established

- Offline operation
- Existing calculations preserved
- Existing UI/functionality preserved unless explicitly requested
- Three-column landscape structure
- PWA files preserved
- Android packaging through GitHub Actions

---

# 4. V2.4.0 Planner

## Major Work

The Planner was introduced as a layer above the existing trading engines.

### BE corrections

- Balance remains unchanged on BE.
- BE is recorded as a Trade.
- Masaniello `nRemaining` is consumed by BE.
- `kRemaining` remains unchanged by BE.
- Win/Loss behavior remains unchanged.

### Undo

Undo was kept compatible with the existing replay architecture.

Undoing BE:

- removes the Trade
- restores `nRemaining`
- does not change `kRemaining`
- does not change Balance
- corrects BE counters

### Simple Planner

The invalid `capital - capital` Stop Loss path was corrected.

The real Stop Loss setting is passed to the calculation.

Plans exceeding valid stake constraints can be marked invalid.

### Session End

Session End was expanded to support:

- Target
- Stop Loss
- Manual End
- Cancel
- Save
- Delete Without Save

The dialog remains visible until the user chooses an action.

Deleting the current session does not delete previous History.

### Target

Target handling was unified around `targetBalance`.

Percentage and amount targets resolve into the same final target value.

Planner/Session paths were aligned to avoid contradictory target values.

### CSV

- BE retained
- Signature value retained as `re3ae6`
- `Signature` column removed
- filename standardized to `TM.re3a.csv`

### Testing

The test suite was expanded from the original baseline.

---

# 5. V2.8 Modern Cockpit

## UI Direction

The project moved toward:

**Dark Modern Cockpit**

The goal was not to remove functionality, but to improve:

- information hierarchy
- readability
- progressive disclosure
- mobile usability
- landscape usability

### Identified UI problem

Too many information blocks were presented at the same visual priority.

Important information included:

- Session controls
- Win / BE / Loss
- Undo
- Next Stake
- Balance
- Profit
- Target
- Plan
- Statistics
- History
- Tools

The direction was changed toward collapsible sections and clearer hierarchy.

---

# 6. V2.9 — Clean Cockpit UI

## Navigation

### Final direction

There must be **one navigation menu only**.

The project must not have:

- a second menu
- a second drawer
- a separate Gear/Settings navigation
- duplicate navigation paths

Settings belongs inside the single main menu.

The Gear icon was intentionally removed from the main UI.

### History

History was moved away from the main trading dashboard.

History is accessed through:

`About → History`

The reason is that History is not normally needed while actively executing a trade.

---

## 6.1 Collapsible Information Architecture

All major cards can be collapsible.

### Principle

- High-priority trading information → open
- Frequently used planning information → open or summarized
- Lower-frequency information → collapsed
- No existing feature is removed

The objective is:

**Clean + Quiet + Fast to Understand**

not:

**Hide Information**

---

## 6.2 Landscape

Landscape retains the three-column design.

All three columns are collapsible.

The third column is:

**Open by default**

because the open state provides better visual balance.

All columns must have appropriate independent scrolling.

No column may:

- clip content
- hide its lower content
- overflow outside the viewport
- place content underneath the Android navigation bar

---

## 6.3 Mobile / Safe Area

The UI must preserve:

- natural scrolling
- readable typography
- touch-friendly controls
- safe bottom spacing
- Android navigation-bar clearance
- no clipping
- no horizontal overflow

---

## 6.4 Drawer Behavior

The main navigation drawer must behave as an overlay.

It must not:

- resize the main application
- move the main columns
- change page width
- cause layout jumps
- cause content to disappear and then reappear

Correct model:

`Main Layout remains fixed`

`Drawer overlays Main Layout`

---

## 6.5 Error Handling

A major usability requirement was identified:

If the user enters an invalid number, the application must not appear to freeze without explanation.

Validation errors should provide short user-facing guidance.

Examples:

- `Target نامعتبر است. مقدار Target را بررسی کنید.`
- `Stake خارج از محدوده مجاز است.`
- `این Plan با تنظیمات فعلی قابل محاسبه نیست.`

Technical stack traces should not be exposed to the user.

---

# 7. V2.9 R2 UI Corrections

The following problems were specifically addressed:

### Drawer

- drawer behavior corrected toward overlay behavior
- main layout should remain stable

### Broken HTML

A malformed HTML fragment such as:

`/div>`

was corrected to:

`</div>`

### Landscape scrolling

Three-column scrolling behavior was corrected so that each column can contain more content without clipping the lower area.

### Build

The `www/` output was rebuilt from source after the corrections.

---

# 8. V2.9 Complete R3 — Feature Completion Direction

The intended R3 expansion added the following decision-support layers.

## 8.1 Risk Engine

The Risk Engine is intended to analyze:

- Risk Score
- Risk Level
- Stake Exposure
- Max Stake
- Max Drawdown
- Loss Streak
- Target Distance
- Stop Loss Distance
- Recovery Exposure

Risk levels:

- Safe
- Moderate
- High
- Extreme

Important rule:

Risk Engine must not become an independent replacement for Simple or Masaniello.

---

## 8.2 Recovery Engine

Recovery must not be a simplistic:

`Stake × 2`

Martingale.

Recovery must respect:

- Maximum Stake
- Maximum Drawdown
- Stop Loss
- Recovery Target
- Maximum Attempts
- Capital Protection

Conceptual flow:

```text
Loss
  ↓
Can Recovery?
  ├── YES → Calculate Safe Recovery Stake
  └── NO  → STOP
```

BE is neutral in Recovery.

Win may reset Recovery state.

Loss advances Recovery state.

---

## 8.3 Strategy Comparison

The intended comparison layer evaluates:

- Simple
- Masaniello
- Recovery

using common inputs such as:

- Capital
- Target
- Payout
- Stop Loss
- Max Loss
- Number of Trades

Possible outputs:

- Initial Stake
- Average Stake
- Max Stake
- Max Drawdown
- Worst Case
- Scenario Result
- Number of Trades
- Risk Level

---

## 8.4 Scenario Stress Testing

The intended Simulator expansion includes:

- Best Case
- Normal Case
- Worst Case
- Custom
- Random

Random simulation should be reproducible with a Seed where implemented.

Random simulation must never replace deterministic calculations.

---

## 8.5 Scenario Comparison

The system should eventually compare sequences such as:

```text
Scenario A:
W W L BE W

Scenario B:
L L BE W W

Scenario C:
L L L BE W
```

with:

- Final Balance
- Profit
- Max Drawdown
- Max Stake
- Trades
- Target Hit
- Stop Loss Hit

---

## 8.6 Advanced Analytics

Candidate analytics:

- Win Rate
- Loss Rate
- BE Rate
- Average Win
- Average Loss
- Profit Factor
- Max Drawdown
- Max Loss Streak
- Average Stake
- Max Stake

Every metric must be derived from real data.

No decorative/fake metrics.

---

# 9. Testing Policy

Every feature change requires tests.

### BE

- Simple BE
- Masaniello BE
- Multiple BE
- BE + Win
- BE + Loss
- Undo BE

### Planner

- Low Risk
- Medium Risk
- High Risk
- Stop Loss
- Target
- Invalid Plan

### Recovery

- Loss
- Recovery
- Recovery Limit
- Max Stake
- Stop Recovery
- Reset

### Simulator

- Best Case
- Worst Case
- Custom
- BE
- Mixed Results

### Session

- Target
- Stop Loss
- Manual
- Cancel
- Save
- Delete

### Persistence

- Save
- Reload
- Import
- Export
- Migration

---

# 10. Build Policy

After every significant phase:

```text
npm run check
npm test
npm run build
```

All must pass before a version is declared complete.

After Build:

`src/` → source of truth

`www/` → generated build output

Manual divergence between them is not allowed without an explicitly documented reason.

---


# 15. 2026-08-11 — Phase 1 UI Stability Pass (R3 → R3.1)

## Objective

Stabilize the current Cockpit UI before continuing with deeper feature development.
The work was intentionally limited to UI behavior, viewport safety and user-facing
validation feedback. Existing trading calculations and engines were not rewritten.

## Confirmed Problems Addressed

- Mobile/Android drawer behavior could expose layout movement during opening.
- Landscape viewport sizing could allow padding/height interactions to clip lower content.
- Column scrolling needed stronger independent-scroll constraints.
- Invalid numeric input needed a visible UI indication in addition to the existing explanatory message.

## Files Changed

- `src/css/app.css`
- `src/js/app.js`
- `www/` generated from source by the normal build process
- `PROJECT_CHANGELOG.md`

## Exact Changes

### Drawer

- Kept the project to one main menu.
- Preserved the overlay-drawer architecture.
- Removed the drawer opening animation so Android WebView cannot display an intermediate layout state while the drawer opens.
- Kept the drawer fixed to the viewport so opening it does not resize/reflow the main application grid.

### Landscape viewport

- Landscape app is explicitly constrained to the viewport height.
- Body padding is removed in the short landscape viewport used by the APK.
- App and grid use border-box sizing for predictable height calculations.
- Three columns keep independent vertical scrolling.
- `min-height:0` and overflow constraints are applied to the three columns to prevent flex/grid children from forcing the parent beyond the available viewport.
- Horizontal overflow remains suppressed.
- Scroll behavior remains touch-friendly.

### Mobile safe area

- Left/right safe-area padding is respected.
- Drawer width is constrained to the available viewport.
- App width is prevented from exceeding the available mobile viewport.

### Input validation UX

- Existing validation logic was preserved.
- Invalid validated inputs now receive `aria-invalid=true`.
- Valid inputs automatically clear the invalid state.
- Existing user-facing validation messages remain the source of explanation.

## Logic Impact

No changes were made to the trading calculations or existing engines.

## State / Storage Impact

No state schema or storage migration was introduced.

## Tests

- `npm run check` → PASS
- `npm test` → 45/45 PASS
- `npm run build` → PASS
- `src/css/app.css` ↔ `www/src/css/app.css` → SYNC
- `src/js/app.js` ↔ `www/src/js/app.js` → SYNC

## Structural Verification

- One `optionsMenu` exists.
- No Gear/Settings icon is present in the main HTML.
- History remains inside the About modal.
- Landscape uses three explicit columns.
- The drawer is fixed-position and overlay-based.

## Remaining Items

Not claimed complete in this phase:

- Full technical/code-quality audit
- Full Risk Engine audit
- Recovery Engine audit
- Strategy Comparison audit
- Scenario Stress Testing audit
- Advanced Analytics audit
- Full backup/migration audit
- Final APK hardware validation across portrait/landscape devices

## Rollback

Revert the Phase 1 changes to `src/css/app.css` and `src/js/app.js`, then regenerate `www/` using `npm run build`. No data migration is involved.

## Deliberately Unchanged

Simple, Masaniello, BE, Planner, Recovery, Risk Engine, Strategy Comparison, Stress Testing, session accounting, state structure, storage format, and offline architecture were deliberately left intact.

# 11. V2.9.0 — Phase 8 — Final Polish & Release Audit

## Objective

Complete the release-readiness audit without introducing a new trading engine or
changing established Simple, Masaniello, BE, Planner, Recovery, Target, Stop
Loss, Session, Storage, Strategy Comparison, Stress Testing, or Analytics
behavior.

## Confirmed Findings

### Runtime error visibility

Input validation already handled the known invalid-number cases, but unexpected
JavaScript errors or rejected asynchronous operations could still present as an
apparently frozen application with no user-facing explanation.

### Offline shell

The Service Worker app shell already contains the runtime modules required by
the current application and its cache version is `v2.9.0`.

### Source/build synchronization

The generated `www/` tree matched the source after rebuilding.

### Android workflow

The workflow continues to remove and verify the Android `INTERNET` permission
after Capacitor synchronization.

A `package-lock.json` was not generated in this environment because the npm
registry metadata was unavailable. The workflow therefore retains its existing
safe fallback to `npm install`. This is documented as a release-process
improvement rather than silently inventing a lockfile.

## Changes

### 1. Runtime error guard

`src/js/app.js` now installs global handlers for:

- `window.error`
- `window.unhandledrejection`

Technical details remain in the developer console.

The user receives a short Persian message explaining that an unexpected error
occurred and asking them to check inputs and retry.

The existing application dialog is reused; no new UI system or dependency was
introduced.

### 2. No calculation changes

The following engines and contracts were deliberately left unchanged:

- Simple
- Masaniello
- BE
- Planner
- Recovery
- Target
- Stop Loss
- Session
- Strategy Comparison
- Stress Testing
- Analytics
- Storage

### 3. Regression tests

A release-audit test was added to verify that the runtime error guard remains
present in the source and that the required user-facing error path is retained.

## Verification

```text
npm run check → PASS
npm test      → 61/61 PASS
npm run build → PASS
src ↔ www     → SYNC
```

## Release Audit

Verified:

- single navigation menu remains
- Settings remains inside that menu
- no separate Gear navigation was restored
- History remains outside the active trading dashboard
- three-column landscape structure remains
- collapsible panels remain
- third column remains open by default
- Service Worker cache version is current
- current runtime modules are in the app shell
- manifest remains offline/standalone oriented
- no new online dependency was introduced
- no new INTERNET permission was introduced
- existing tests remain green
- generated `www/` matches source
- invalid setup inputs continue to produce explanatory messages
- unexpected runtime failures now also produce an explanatory message

## Deliberately Unchanged

No architecture rewrite was performed.

No feature was removed.

No existing formula was replaced.

No state migration was introduced.

No storage schema was changed.

No new network/API dependency was added.

## Remaining Release-Process Improvement

A committed `package-lock.json` would make GitHub Actions installs fully
reproducible with `npm ci`. It was not added during this phase because the
available environment could not resolve the npm registry metadata. This item
should be completed when a network-enabled development/build environment is
available.

---

# 11. Current Project Roadmap

## Phase 1 — UI Stability

Status: IN PROGRESS / VERIFY

Focus:

- Drawer
- Mobile overflow
- Landscape scrolling
- Safe Area
- Typography
- Card hierarchy
- Empty-space optimization
- Touch targets
- Error messages

---

## Phase 2 — Full Technical Audit

Status: PENDING

Audit:

- State
- Storage
- Dependencies
- Source of Truth
- Dead Code
- Duplicate Logic
- Event Listeners
- CSS
- Planner
- Analyzer
- Simulator
- History
- Backup/Restore

---

## Phase 3 — Risk Engine

Status: PENDING / VERIFY ACTUAL IMPLEMENTATION

Goal:

Turn current analysis into a deterministic and explainable Risk Engine.

---

## Phase 4 — Recovery Engine

Status: PENDING / VERIFY ACTUAL IMPLEMENTATION

Goal:

Safe constrained recovery without unlimited Martingale behavior.

---

## Phase 5 — Strategy Comparison

Status: PENDING

Goal:

Compare Simple / Masaniello / Recovery under equal inputs.

---

## Phase 6 — Scenario Stress Testing

Status: PENDING

Goal:

Best / Normal / Worst / Custom / Reproducible Random.

---

## Phase 7 — Advanced Analytics

Status: PENDING

Goal:

Decision-support analytics based on actual Session and History data.

---

## Phase 8 — Final UX Polish

Status: PENDING

Goal:

Make the application:

- clean
- compact
- readable
- fast to understand
- usable during active trading
- useful for analysis outside active trading

---

# 12. Change Entry Template

Every future change MUST add a new entry using this structure:

## [VERSION] — [DATE] — [PHASE]

### Objective

What problem are we solving?

### Confirmed Problem

What was actually found in the code/UI?

### Files Changed

List every changed file.

### Before

Describe the previous behavior.

### Change

Describe exactly what changed.

### After

Describe the resulting behavior.

### Logic Impact

Explain whether calculations or existing engines were affected.

### State / Storage Impact

Describe any state or persistence changes.

### UI Impact

Describe UI changes.

### Tests Added/Changed

List tests.

### Test Result

```text
npm run check:
npm test:
npm run build:
```

### src / www

State whether they are synchronized.

### Risks

Remaining risks.

### Rollback

How to revert the change.

### Deliberately Unchanged

List important things intentionally not modified.

---

# 13. Decision Log

The following user decisions are project constraints:

### Navigation

One menu only.

### Gear

No separate Gear/Settings button in the main UI.

### Information

Nothing should be deleted merely to make the interface cleaner.

### Collapsible Cards

All relevant cards can collapse.

### Third Column

Open by default for visual balance.

### Layout

Three columns in landscape must be preserved.

### UI Goal

Clean and quiet, not exhausting or oversized.

### Error Handling

Invalid input must produce a short understandable explanation instead of an apparent freeze.

### History

History may remain outside the active trading dashboard and is accessible through About.

### Approval

Major changes and architectural changes require user confirmation before execution.

---

# 14. Final Project Principle

Trade Manager must evolve from:

`Stake Calculator`

toward:

`Trading Plan & Risk Management Tool`

The final objective is decision support.

The application should eventually answer:

> With this Capital, Target, Payout and Risk Limit, what happens under different strategies and scenarios, what is the worst realistic exposure, and which plan is more reasonable?

The project must achieve this without sacrificing:

- existing calculations
- Simple
- Masaniello
- BE
- offline operation
- existing data
- backward compatibility
- testability
- reversibility

---

# 15. Changelog Rule

**Every future modification must be recorded in this file.**

No silent changes.

No undocumented architecture changes.

No undocumented formula changes.

No undocumented UI restructuring.

Every completed Phase must record:

1. What changed
2. Why it changed
3. Which files changed
4. Which tests changed
5. Test results
6. Build result
7. Remaining issues
8. Rollback information

This document is a living project notebook, not a one-time report.

---

# 16. Phase 2 — Full Technical Audit — 2026-08-11

## Objective

Audit the real V2.9 R3.1 source before continuing feature development, with emphasis on:

- architecture
- offline behavior
- Source of Truth
- state/storage
- existing engines
- new decision-support engines
- test coverage
- build integrity
- `src/` → `www/` synchronization

## Audit Result

### Verified

- Simple engine remains a standalone existing engine.
- Masaniello engine remains a standalone existing engine.
- Planner imports and uses existing Simple/Masaniello engines.
- Plan Analyzer is read-only and uses existing sizing engines.
- Scenario Simulator uses the existing Simple/Masaniello engines.
- Strategy Comparison reuses Planner, Scenario Simulator and Recovery rather than rewriting Simple/Masaniello formulas.
- BE is represented as a real Trade while remaining balance-neutral.
- Target resolution is centralized through the Trading Plan/target helpers.
- Session state is persisted through the existing storage layer.
- UI disclosure preferences are persisted separately as UI-only state.
- Only one primary navigation menu exists in the HTML.
- No separate Gear/Settings navigation button exists.
- History is accessible from the About panel.
- Three landscape columns exist and have independent overflow handling.
- `npm run check` passes.
- `npm test` passes.
- `npm run build` passes.
- `src/` and generated `www/src/` contain the same runtime source modules after Build.

### Confirmed Issues Found During Audit

#### 1. Stale displayed application version

`index.html` still displayed `v2.8.0` while the package/runtime version is `2.9.0`.

**Correction:** displayed version changed to `v2.9.0`.

#### 2. Stale Service Worker cache version

`service-worker.js` still used cache version `v2.8`.

**Correction:** cache version changed to `v2.9.0` so the browser/PWA invalidates the older cache.

#### 3. Offline App Shell did not include all new runtime modules

The Service Worker App Shell did not explicitly cache all newly introduced core modules, including:

- `session.js`
- `risk-engine.js`
- `recovery.js`
- `strategy-comparison.js`
- `stress-testing.js`

This was a real offline reliability gap: a fresh offline load could fail to retrieve a module that was not already cached.

**Correction:** all runtime core modules required by the current application were added to the Service Worker App Shell.

#### 4. Risk model remains heuristic

The current Risk Engine is deterministic and transparent, but its thresholds are structural heuristics rather than empirically calibrated probabilities of market loss.

This is intentionally NOT being presented as a statistical probability of losing money.

**Decision:** retain the transparent structural model for now and treat calibration/validation of the risk methodology as a future Risk Engine phase rather than inventing unsupported thresholds.

#### 5. State migration is currently minimal

The current persisted state is versioned at `2`, with a v1→v2 migration that primarily upgrades the version marker.

No additional migration was introduced because no verified schema-breaking change requiring another migration was found during this audit.

Future schema changes must introduce explicit migrations.

## Test Coverage

A new test was added to ensure the Service Worker:

- uses the current cache version
- explicitly includes all runtime core modules required for offline execution

### Test result

```text
npm test       → 46/46 PASS
npm run check  → PASS
npm run build  → PASS
```

## Files Changed in Phase 2

- `index.html`
- `service-worker.js`
- `tests/core.test.mjs`
- `PROJECT_CHANGELOG.md`
- generated `www/index.html`
- generated `www/service-worker.js`
- generated `www/src/*`

## Existing Engines Deliberately Unchanged

The following were not rewritten during this audit:

- Simple formula/engine
- Masaniello formula/engine
- BE calculation contract
- existing Session calculation rules
- existing Planner calculation architecture
- existing Target calculation architecture
- existing Storage schema

## Remaining Technical Work

The audit confirms that the following still require deeper implementation/validation:

1. Formal Risk Engine methodology and calibration.
2. More complete Strategy Comparison across selectable risk profiles rather than only the default comparison selection.
3. More comprehensive Recovery edge-case testing.
4. More comprehensive persistence/import/export/migration tests.
5. Full DOM/UI interaction testing on actual Android APK builds.
6. Deeper code-quality audit of the large `app.js` orchestration layer.
7. Security-oriented review of generated HTML content and imported backup data.
8. Final end-to-end offline installation/cache test on Android.

## Rollback

Phase 2 can be reverted by restoring the previous versions of:

- `index.html`
- `service-worker.js`
- `tests/core.test.mjs`

The core trading engines were intentionally not modified by this Phase.

## Phase Status

**PHASE 2 AUDIT: COMPLETE**

The project is now ready for the next controlled phase: deeper Risk/Decision Engine completion after the verified offline/runtime corrections above.


---

# Phase 3 — Risk & Decision Engine Hardening

## Objective

Strengthen the existing Risk Engine so that it is deterministic, transparent,
auditable, and clearly separated from the actual Simple/Masaniello engines.

## Confirmed Issue

The previous Risk Engine already produced a structural score, but some of its
classification inputs were implicit and `maxLossStreak` affected warnings only,
not the score.

The previous implementation also described the score as heuristic without
returning the active policy used for classification.

## Changes

### `src/js/core/risk-engine.js`

- Preserved the read-only architecture.
- Preserved the 0–100 structural score concept.
- Added an explicit policy object.
- Returned the active policy with every Risk result.
- Added loss-streak contribution to the score.
- Added explicit Target/Stop pressure ratio.
- Added explicit policy limits for:
  - Initial Stake
  - Max Stake
  - Drawdown
  - Exposure
  - Loss Streak
  - Target/Stop pressure
- Improved warnings so the user can understand which structural limit was exceeded.
- Clarified that the score is not a probability of market loss.
- Kept Risk Engine independent from Simple and Masaniello formulas.

### `tests/core.test.mjs`

Added tests for:

- deterministic Risk output
- policy exposure
- loss-streak scoring
- policy override behavior
- warning generation

## Intentionally Unchanged

- Simple engine
- Masaniello engine
- BE behavior
- Session state
- Storage schema
- Planner formulas
- Recovery formula
- Scenario simulator
- Target source of truth

## Validation

- `npm run check` — PASS
- `npm test` — PASS — 49/49
- `npm run build` — PASS
- `www/` regenerated from `src/`

## Files Changed in Phase 3

- `src/js/core/risk-engine.js`
- `tests/core.test.mjs`
- `PROJECT_CHANGELOG.md`

## Phase 3 Result

The Risk Engine is now deterministic, policy-explicit, auditable, and still
read-only with respect to the existing trading engines.

No changes were made to the Simple, Masaniello, BE, Session, Storage, Planner,
Recovery, Scenario Simulator, or Target calculation engines during this phase.


## Remaining Phase 3 Work

The following should still be audited before Phase 3 is declared complete:

- Risk Engine UI presentation
- Risk explanation wording
- Recovery integration boundaries
- Strategy Comparison edge cases
- Stress Testing edge cases
- deterministic scenario coverage
- risk-policy documentation



---

# Phase 4 — Recovery Engine Audit & Completion

## Objective

Audit the Recovery Engine against the project's non-negotiable requirements and
complete only verified safety/edge-case behavior without introducing a
Martingale-doubling strategy or rewriting the existing Simple/Masaniello
engines.

## Audit Findings

The existing Recovery Engine already had the correct high-level architecture:

- bounded recovery
- explicit maximum stake
- stop-loss boundary
- maximum drawdown boundary
- maximum recovery attempts
- BE neutrality
- reset after Win
- deterministic calculation

One concrete edge-case defect was identified.

### Minimum Stake Capacity Bug

Previously, when the required recovery stake was below the configured minimum
stake, the engine could raise the stake to `minStake` without checking whether
that minimum itself exceeded the available recovery capacity.

This could produce a requested stake larger than:

- stop-loss capital room
- drawdown room
- maximum stake

even though the recovery result was marked `canRecover: true`.

This was a real correctness/safety issue.

## Changes

### `src/js/core/recovery.js`

The recovery sizing boundary was hardened.

The engine now:

1. Calculates the available capacity from:
   - capital room above Stop Loss
   - remaining Drawdown allowance
   - configured Max Stake
2. Applies the configured Minimum Stake.
3. Verifies that the final requested stake, including the minimum-stake floor,
   is still within capacity.
4. Refuses recovery when the minimum stake itself is unsafe.
5. Returns an explicit reason:
   - `minimum-stake-exceeds-capacity`
6. Reports requested stake and capacity when a limit is exceeded.

No doubling rule was introduced.

## Recovery Contract

The engine continues to follow:

```text
Loss
 ↓
Can Recovery?
 ├── YES → bounded recovery stake
 └── NO  → STOP
```

### Win

- recovery loss accumulation resets
- recovery attempts reset
- winning profit is applied normally

### Loss

- balance decreases by stake
- accumulated recovery loss increases
- recovery attempt count increases

### BE

- balance remains unchanged
- accumulated loss remains unchanged
- BE is not treated as a loss
- BE does not create recovery profit
- the existing reset-after-BE behavior remains explicit in the current
  implementation

## Tests Added

New tests cover:

- minimum stake exceeding recovery capacity
- maximum recovery attempts
- stop-loss capacity blocking
- Win reset behavior
- BE balance neutrality

The existing Recovery tests remain unchanged.

## Intentionally Unchanged

- Simple engine
- Masaniello engine
- BE contract
- Planner calculation formulas
- Target calculation
- Session calculation rules
- Storage schema
- Risk Engine methodology
- Scenario Simulator architecture
- Strategy Comparison architecture

## Validation

Actual validation after implementation:

```text
npm run check → PASS
npm test      → 53/53 PASS
npm run build → PASS
```

`www/` was regenerated from `src/` after the source change.

## Remaining Recovery Work

The following remain candidates for future audit rather than being changed
speculatively:

- deeper recovery integration with the live Session UI
- recovery state persistence
- explicit user-facing recovery explanation
- comparison of recovery limits against the global Plan Stop Loss
- additional Android end-to-end validation

## Rollback

Restore the previous version of:

- `src/js/core/recovery.js`
- `tests/core.test.mjs`
- generated `www/` output

No existing trading engine formula was changed.

## Phase Status

**PHASE 4 — COMPLETE**

Validated on the generated project package with 53/53 tests passing and a successful web build.


# 16. Phase 5 — Strategy Comparison

## Status

**COMPLETED**

## Objective

Turn the existing Strategy Comparison from a basic three-card summary into a deterministic decision-support comparison while continuing to use the existing Simple, Masaniello, Recovery, Planner, Scenario Simulator, and Risk Engine implementations.

## Confirmed Problem

The previous comparison module already existed, but its output was shallow:

- It exposed only a small subset of metrics.
- Its “Worst/Stress” value was not consistently derived from the same deterministic worst-case simulation for every strategy.
- Recovery, Simple and Masaniello did not expose a common metric contract.
- The UI did not show structural risk classification.
- Invalid scenario input was not explicitly rejected by the comparison layer.

The existing engines themselves were not rewritten.

## Changes

### Strategy Comparison Engine

`src/js/core/strategy-comparison.js` was expanded to return a common comparison contract containing:

- Initial Stake
- Average Stake
- Maximum Stake
- Maximum Drawdown
- Scenario Final Balance
- Scenario Profit
- Trade count
- Win count
- BE count
- Loss count
- Win Rate
- Target Hit
- Stop Loss Hit
- Worst Case Final Balance
- Worst Case metrics
- Deterministic structural Risk Score / Level

The same user inputs are used for all strategies:

- Capital
- Payout
- Target Balance
- Target Profit
- Stop Loss
- Minimum Stake

### Worst Case

Worst Case is now generated deterministically as an all-Loss scenario with sufficient length to expose the strategy's limits. It is not a market-probability prediction.

### Risk Integration

The existing deterministic Risk Engine is used as a read-only decision-support layer over the comparison outputs.

It is explicitly presented as a structural score, not a probability of loss.

### Recovery

Recovery continues to use the bounded Recovery Engine. No Martingale doubling was introduced.

### Scenario Validation

Invalid scenario result values are rejected before comparison. Only `W`, `BE`, and `L` are accepted.

### UI

The Strategy Comparison modal now shows the most decision-relevant metrics rather than only a minimal summary. It includes:

- Structural Risk
- Initial Stake
- Average Stake
- Max Stake
- Max Drawdown
- Worst Case Balance
- Current Scenario Balance
- Target status
- Stop Loss status

The existing modal/menu architecture was preserved.

## Existing Engines Deliberately Unchanged

No rewrite was made to:

- `simple.js`
- `masaniello.js`
- `planner.js`
- `recovery.js`
- `risk-engine.js`
- `scenario-simulator.js` calculation logic
- Storage architecture
- Session state

The comparison layer consumes their outputs rather than duplicating their formulas.

## Files Changed

- `src/js/core/strategy-comparison.js`
- `src/js/app.js`
- `tests/core.test.mjs`
- `PROJECT_CHANGELOG.md`

`www/` was regenerated by the normal build process.

## Tests Added

1. Strategy Comparison exposes the common decision-support metrics and deterministic Worst Case.
2. Strategy Comparison rejects invalid scenario results.

## Test Results

```text
npm run check → PASS
npm test      → 55/55 PASS
npm run build → PASS
```

## Source / Build Synchronization

`src/` and generated `www/` comparison/application files were regenerated and verified synchronized.

## Risk / Remaining Work

The comparison currently selects the best available valid medium-risk plan (or first valid plan) for Simple and Masaniello. A future version may allow explicit user-selected risk profiles, provided this does not duplicate engine logic.

The Worst Case scenario is deterministic stress testing, not a statistical forecast.

Recovery comparison remains bounded by configured attempts, maximum stake, drawdown and stop-loss constraints.

## Rollback

Revert the Phase 5 changes to:

- `src/js/core/strategy-comparison.js`
- `src/js/app.js`
- `tests/core.test.mjs`

Then rebuild `www/`.

## Deliberately Unchanged

No changes were made to core trading formulas, BE semantics, session persistence, Simple sizing, Masaniello calculations, or Recovery rules.

---

# 16. V2.9 Phase 6 — Scenario Stress Testing

## Status

**COMPLETED**

## Objective

Expand the existing deterministic Scenario/Stress infrastructure into a practical stress-testing layer without replacing Simple, Masaniello, Recovery, Planner, or Risk Engine logic.

## Confirmed Existing State

Before this phase, the project already contained:

- `scenario-simulator.js`
- `stress-testing.js`
- Best Case generation
- Normal Case generation
- Worst Case generation
- Seeded Random generation
- Scenario simulation using the existing Simple/Masaniello engines

However, the Stress Test UI did not expose a true Custom scenario and the random scenario probabilities were fixed internally.

## Changes

### Stress Testing Engine

`src/js/core/stress-testing.js`

Added:

- Custom scenario support
- Configurable Win probability
- Configurable Loss probability
- Configurable BE probability
- Validation that probabilities are non-negative and sum to 100%
- Deterministic seeded random generation remains intact
- Recovery Stress Testing now uses the same Best / Normal / Worst / Custom / Random scenario framework
- Invalid probability configurations return a clear structured error

### Stress Scenario Types

The stress layer now supports:

1. Best Case
2. Normal Case
3. Worst Case
4. Custom
5. Random (seeded)

### Random Simulation Rule

Random simulation remains deterministic for a given seed and probability configuration.

Random simulation is explicitly treated as a stress/decision-support tool and does not replace deterministic plan calculations.

### Stress Test UI

`index.html`

Added controls for:

- Custom scenario input
- Win probability
- Loss probability
- BE probability
- Run Stress Test

The UI displays:

- Scenario sequence
- Final Balance
- Profit
- Max Drawdown
- Max Loss Streak
- Target status
- Stop Loss status
- Lock/continuation status

### Application Logic

`src/js/app.js`

Updated Stress Test rendering to use the new Custom and probability-controlled Random scenarios.

Invalid probability input produces a clear user-facing message instead of silently failing.

### Styling

`src/css/app.css`

Added compact Stress Test input/probability layout while preserving the existing cockpit visual language.

## Files Changed

- `src/js/core/stress-testing.js`
- `src/js/app.js`
- `src/css/app.css`
- `index.html`
- `tests/core.test.mjs`
- `PROJECT_CHANGELOG.md`
- Generated `www/` files after build

## Tests Added

- Stress testing supports Custom scenarios and configurable random probabilities
- Stress testing rejects invalid random probabilities
- Recovery Stress Testing includes Custom and Random scenarios

## Validation

```text
npm run check → PASS
npm test      → 58/58 PASS
npm run build → PASS
```

## Architecture Impact

No rewrite of:

- Simple
- Masaniello
- Recovery
- Planner
- Risk Engine
- Session
- Storage

The Stress Test layer consumes existing engines and simulation primitives.

## BE Contract

BE remains a real Trade while remaining balance-neutral. Stress metrics continue to count:

`Trades = Wins + BE + Losses`

## Deliberately Unchanged

- Existing deterministic calculations
- Existing Simple engine
- Existing Masaniello engine
- Existing Recovery limits
- Existing Target source of truth
- Existing Stop Loss semantics
- Offline architecture
- Capacitor configuration
- Existing navigation architecture

## Remaining Work

Phase 7 — Advanced Analytics

Candidate areas:

- Equity Curve
- Profit Curve
- Win Rate / Loss Rate / BE Rate
- Average Win / Average Loss
- Profit Factor
- Max Drawdown
- Max Loss Streak
- Average Stake
- Max Stake

Analytics must remain decision-oriented; decorative charts should not be added without a useful question they answer.

# 16. Phase 7 — Advanced Analytics

## Date
2026-08-11

## Status
COMPLETED

## Objective
Strengthen the analytics layer so the dashboard can expose useful decision-support metrics from real stored session data without inventing intratrade history that the application does not store.

## Confirmed Findings
The existing analytics engine already calculated several useful metrics, including:

- total sessions
- trades
- wins / losses / BE
- Win Rate
- BE Rate
- Loss Rate
- Net Profit
- Average Win / Loss
- Profit Factor
- Best / Worst Session
- session-end Max Drawdown

However, the stored session record did not preserve several useful session-level metrics that are available at the moment a session is saved. As a result, historical analytics could not reliably report:

- maximum win streak
- maximum loss streak
- average stake
- maximum stake
- per-session drawdown metrics

The project also intentionally does not store every historical intratrade balance point for closed sessions in `sessionHistory`. Therefore the analytics layer must not pretend that historical drawdown is an intratrade equity curve.

## Changes

### `src/js/app.js`
When a session is saved, the existing real trade data is used to persist additional session-level analytics:

- `maxWinStreak`
- `maxLossStreak`
- `maxDrawdown`
- `maxDrawdownPct`
- `averageStake`
- `maxStake`

These values are derived from the actual session trades using the existing `computeSessionStatistics()` helper.

No trading calculation was changed.

### `src/js/core/analytics.js`
The analytics engine now aggregates the newly stored metrics when available:

- weighted average stake across trades
- maximum historical stake
- maximum historical loss streak
- maximum historical win streak

The analytics engine remains backward-compatible: old history entries that do not contain these fields return `null` for those historical metrics instead of guessing values.

The existing BE convention remains unchanged:

`Trades = Wins + BE + Losses`

### `index.html`
The performance dashboard now exposes additional decision-support metrics:

- BE Rate
- Loss Rate
- Profit Factor
- Average Stake
- Max Stake
- Max Loss Streak

These are added without removing existing dashboard information.

## Deliberately Unchanged

- Simple engine
- Masaniello engine
- BE behavior
- Planner formulas
- Recovery engine
- Strategy Comparison calculations
- Scenario Stress Testing
- Target source of truth
- Stop Loss behavior
- Storage version/migration mechanism
- Offline architecture
- Capacitor configuration

## Testing

Two tests were added:

1. Advanced analytics aggregates BE rate, Profit Factor and stored stake/streak metrics.
2. Advanced analytics remains backward-compatible with old session records.

Final results:

```text
npm run check → PASS
npm test      → 60/60 PASS
npm run build → PASS
src ↔ www     → SYNC
```

## Important Analytics Limitation

Historical Max Drawdown remains explicitly based on stored session-end balances unless intratrade historical balances are persisted. The implementation does not fabricate an equity curve from incomplete data.

## Rollback

Revert the Phase 7 changes to:

- `src/js/app.js`
- `src/js/core/analytics.js`
- `index.html`
- `tests/core.test.mjs`
- generated `www/`
- this changelog entry

## Result

Phase 7 — Advanced Analytics is complete and ready for Phase 8 Final Polish / Release Audit.

---

# Phase 8.1 — Final Decision Confirmation / Landscape Symmetry

Date: 2026-08-11

## Confirmed decisions

The following two points were explicitly confirmed after the Phase 8 independent audit:

### 1. Masaniello BE contract is locked

BE is a real executed trade, but remains neither Win nor Loss.

For Masaniello:

- `nRemaining` decreases by one.
- `kRemaining` does not decrease.
- Balance does not change.
- BE is counted as a Trade.
- Win Rate remains `Wins / Trades`.

This behavior is now considered an intentional project contract and must not be changed without explicit approval.

### 2. Landscape columns are locked to equal width

The three primary landscape columns must have equal visual width.

The third column remains open by default for visual usability, but its open state must not change the width ratio of the three columns.

The landscape grid is therefore:

`1fr / 1fr / 1fr`

All three columns retain independent scrolling and collapsible content.

## Change made

### `src/css/app.css`

Changed the landscape primary grid from unequal fractional widths to equal-width columns:

Before:

`1.25fr / 1.05fr / 0.9fr`

After:

`1fr / 1fr / 1fr`

No trading engine, calculation, storage, BE, Planner, Recovery, or Session logic was changed in this confirmation step.

## Validation required

After this CSS-only correction:

- `npm run check`
- `npm test`
- `npm run build`
- `src` → `www` synchronization

must all pass before this build is considered the next Release Candidate.

## Locked project decisions

- One navigation menu only.
- No separate gear/settings menu.
- No feature removal.
- All relevant cards remain collapsible.
- Low-use cards may remain collapsed.
- Third landscape column is open by default.
- Three primary landscape columns have equal width.
- BE consumes one Masaniello trade while remaining balance-neutral and not changing `kRemaining`.

## V2.9.x — UI Polish Pass: Compact Cockpit & Navigation Cleanup — 2026-08-12

### Objective
Refine the already-stabilized cockpit UI without changing trading logic, calculations, or strategy engines.

### Confirmed Changes
- Kept Persian text in the Session End dialog while reducing dialog and button geometry.
- Kept the existing toggle control size; removed unnecessary explanatory text and reduced surrounding whitespace.
- Removed the "هدف مشترک برنامه و سشن" divider from Target & Plan.
- Put the target type selector and target numeric input into a compact, aligned row.
- Kept numeric inputs aligned with consistent height/width rhythm.
- Corrected Stress Test number-input text contrast so entered values are readable.
- Kept all Stress Test probability fields as numeric inputs.
- Preserved the system clock/notifications; reduced only the application's header height and internal spacing.
- Kept Session, Balance, Mode toggle and main menu compactly aligned in the available header space.
- Removed duplicate Session/Planner entries from the main navigation menu; those functions remain on the main cockpit where they are actively used.
- Kept a single main menu for tools/settings/about.
- Changed the tools section header to an icon-only affordance inside the single menu.
- Added a real clickable drawer backdrop so tapping outside the menu closes it immediately.
- Preserved overlay behavior: opening the menu must not resize/reflow the application.
- Preserved equal landscape column widths and third-column default-open behavior.
- Preserved independent landscape scrolling.

### Deliberately Unchanged
- Simple engine
- Masaniello engine
- BE semantics
- Recovery engine
- Planner calculations
- Risk engine calculations
- Scenario/Stress algorithms
- Storage schema
- Target calculation semantics

### Verification
- `npm run check` — PASS
- `npm test` — 61/61 PASS
- `npm run build` — PASS
- `www/` regenerated from `src/`


## V2.9.x — Payout Contract & BE Neutrality Correction — 2026-08-12

### Payout
- Corrected the user-facing payout contract: `0.85` represents 85% payout and `0.92` represents 92% payout.
- Valid user-facing range is `0.01`–`1.00`.
- Legacy values such as `85` are normalized to `0.85` for backward compatibility.
- Percent-based internal Planner/Analyzer/Comparison APIs receive the normalized percent value (85/92), while trade engines receive the decimal payout (0.85/0.92).
- Removed the old 0.01–500 validation contract that could incorrectly reject valid instrument payout inputs.

### BE
- BE remains a real session trade for statistics (`Trades` and `BE` increase).
- BE does not change balance, `nRemaining`, or `kRemaining` in Masaniello.
- Scenario simulation follows the same neutral BE rule.
- Updated the affected tests to enforce the neutral two-layer BE model.

### Verification
- `npm test` — 61/61 PASS
- `npm run check` — PASS
- `npm run build` — PASS
- `www/` regenerated from `src/`
