# AI Context — Trade Manager

## Project

This is a personal, offline Trade Manager application.

The computational engine is critical project logic. Existing calculation behavior is a red line.

Before changing any calculation formula or engine behavior:
1. Read the current implementation.
2. Explain its current behavior.
3. Get explicit user approval before changing it.

Do not modify the trading engine merely to make a UI change.

---

# Masaniello — Correct BE (Break-Even) Semantics

Each trade has exactly three possible outcomes:

- Win
- Loss
- BE (Break-Even)

BE means the account balance before and after the trade is exactly the same:
no profit and no loss.

## Critical rule

BE is a real trade for session statistics, but it is mathematically neutral for the Masaniello engine.

There are therefore TWO separate layers.

### Layer 1 — Session Statistics

BE counts as a real trade.

Therefore:

    Trades = Wins + BE + Losses

And:

    Win Rate = Wins / Trades

A BE must increase the session's trade/breakeven statistics.

### Layer 2 — Masaniello Engine State

BE must NOT advance the Masaniello mathematical plan because no money was gained or lost.

When BE occurs:

- balance MUST NOT change
- nRemaining MUST NOT decrease
- kRemaining MUST NOT change

Only Win and Loss consume one Masaniello opportunity.

In other words:

- Win -> consumes one opportunity and changes the mathematical state
- Loss -> consumes one opportunity and changes the mathematical state
- BE -> records a trade but leaves the Masaniello mathematical state unchanged

---

# Why this rule is mandatory

A previous version incorrectly treated BE as consuming nRemaining.

Example:

Masaniello plan:

    n = 10
    k = 6

Therefore up to 4 losses are allowed.

If five consecutive BE trades occur:

    Balance = unchanged
    Wins = 0
    Losses = 0
    BE = 5
    Trades = 5

With the WRONG implementation, every BE consumed nRemaining.

After enough BE results, the engine could eventually report the plan as impossible even though the account had never lost any money.

That is mathematically wrong.

With the CORRECT implementation, after five consecutive BE results:

    balance = unchanged
    nRemaining = 10
    kRemaining = 6
    trades = 5
    BE = 5

And:

    kRemaining <= nRemaining

must remain true.

The Masaniello target is still fully achievable because no actual Win/Loss event has occurred.

---

# Files that MUST be inspected before changing this behavior

At minimum inspect:

1. `src/js/core/session.js`

Main live-session engine.

Pay particular attention to:

    applyTradeOutcome

2. `src/js/core/scenario-simulator.js`

This simulator has independent scenario logic.

Do NOT assume fixing `session.js` automatically fixes the simulator.

Previously the same BE bug existed independently in this file.

3. Any other module that independently updates:

    nRemaining
    kRemaining
    balance

in response to trade outcomes.

Search the entire repository if necessary.

---

# Required BE behavior

When the outcome is BE:

### Must change

Session statistics such as:

    trades
    breakevens

must increase appropriately.

### Must NOT change

    balance
    nRemaining
    kRemaining

Do not silently reinterpret BE as Loss, Win, or a consumed Masaniello opportunity.

---

# Required regression test

The project must preserve behavior equivalent to this test:

Start with a Masaniello plan:

    n = 10
    k = 6

Apply BE five times consecutively.

Expected state:

    balance unchanged
    nRemaining = 10
    kRemaining = 6
    trades = 5
    breakevens = 5
    wins = 0
    losses = 0

And:

    kRemaining <= nRemaining

must be true.

The plan must still be executable/achievable.

If the project's test framework differs, create the equivalent regression test using the existing testing conventions.

---

# Regression rule

If any code is found where BE changes:

    balance
    nRemaining
    kRemaining

treat it as a regression or a potentially incorrect implementation.

DO NOT automatically "fix" it just because a test currently expects that behavior.

Existing tests may themselves have been written around the old incorrect behavior.

First explain:

1. Which file/function contains the behavior.
2. What the current code does.
3. Why it conflicts with the agreed BE definition.
4. What tests currently expect.
5. What the corrected behavior would be.

Then ask the user for explicit approval before changing the engine.

---

# Important distinction

Do not confuse:

    trades

with:

    Masaniello opportunities consumed

A BE increments the first.

A BE does NOT decrement the second.

Therefore it is completely valid to have:

    trades = 5
    nRemaining = 10

after five consecutive BE results.

This is intentional.

---

# UI safety rule

The Trade Manager UI may be redesigned or modernized, but UI work must not alter the computational engine.

Presentation changes should remain isolated from:

- Masaniello formulas
- session accounting
- outcome processing
- balance calculations
- nRemaining
- kRemaining
- scenario simulation

If a UI change appears to require changing engine behavior, stop and explain the dependency before proceeding.

---

# Current agreed project decision

The user explicitly agreed that:

BE is counted as a real trade in session statistics.

BE is mathematically neutral in Masaniello.

Therefore:

    BE:
      trades += 1
      breakevens += 1
      balance unchanged
      nRemaining unchanged
      kRemaining unchanged

This decision must NOT be changed without explicit re-approval from the user.
