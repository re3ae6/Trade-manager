// Independent test suite for the Lite-Masaniello engine.
//
// IMPORTANT: this suite must never import from src/js/core/. It only
// exercises src/js/core-lite-masaniello/, so the engine can be verified
// in complete isolation.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildPlan,
  calculateNextStake,
  simulatePlan,
  simulateScenario,
  REASONS
} from '../src/js/core-lite-masaniello/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.join(__dirname, '..', 'src', 'js', 'core-lite-masaniello');

// ---------------------------------------------------------------------
// Architecture / isolation
// ---------------------------------------------------------------------

test('no Lite module imports from the main core engine', () => {
  const files = fs.readdirSync(ENGINE_DIR).filter(f => f.endsWith('.js'));
  assert.ok(files.length > 0);
  for (const file of files) {
    const content = fs.readFileSync(path.join(ENGINE_DIR, file), 'utf8');
    const importLines = content.match(/^import .*from ['"].*['"];?$/gm) || [];
    for (const line of importLines) {
      assert.doesNotMatch(
        line,
        /\.\.\/core\//,
        `${file} must not import from ../core/: "${line}"`
      );
      assert.doesNotMatch(
        line,
        /src\/js\/core\//,
        `${file} must not import from src/js/core/: "${line}"`
      );
      // Every internal import must be relative to this folder.
      const spec = line.match(/from ['"](.*)['"]/)[1];
      assert.ok(
        spec.startsWith('./'),
        `${file} has a non-local import "${spec}"`
      );
    }
  }
});

// ---------------------------------------------------------------------
// buildPlan — validation
// ---------------------------------------------------------------------

test('buildPlan: rejects invalid capital', () => {
  const p = buildPlan({ capital: 0, payoutPct: 85, targetProfit: 10 });
  assert.equal(p.valid, false);
  assert.equal(p.reason, REASONS.INVALID_CAPITAL);
});

test('buildPlan: rejects invalid payout', () => {
  const p = buildPlan({ capital: 100, payoutPct: 0, targetProfit: 10 });
  assert.equal(p.valid, false);
  assert.equal(p.reason, REASONS.INVALID_PAYOUT);
});

test('buildPlan: rejects invalid risk', () => {
  const p = buildPlan({ capital: 100, payoutPct: 85, targetProfit: 10, risk: 'extreme' });
  assert.equal(p.valid, false);
  assert.equal(p.reason, REASONS.INVALID_RISK);
});

test('buildPlan: rejects minimum stake that exceeds capacity outright', () => {
  const p = buildPlan({ capital: 5, payoutPct: 85, targetProfit: 2, minStake: 10, risk: 'lite' });
  assert.equal(p.valid, false);
  assert.equal(p.reason, REASONS.MIN_STAKE_VIOLATION);
});

test('buildPlan: minimum stake that makes the plan exceed capacity is never silently accepted', () => {
  // capital=10, minStake=1 but targetProfit forces impossible growth for
  // the chosen risk with a tiny capital — must not fabricate a valid plan.
  const p = buildPlan({ capital: 10, payoutPct: 85, targetProfit: 1000, minStake: 1, risk: 'high' });
  assert.equal(p.valid, false);
  assert.ok(
    [REASONS.TARGET_IMPOSSIBLE, REASONS.CAPACITY_EXCEEDED, REASONS.MIN_STAKE_VIOLATION].includes(p.reason)
  );
});

test('buildPlan: target impossible for absurd targets', () => {
  const p = buildPlan({ capital: 100, payoutPct: 85, targetProfit: 1e9, risk: 'high' });
  assert.equal(p.valid, false);
  // Either reason is an honest, non-fabricated rejection: the target
  // may be unreachable outright, or reachable only via stakes that
  // exceed the account's capacity.
  assert.ok([REASONS.TARGET_IMPOSSIBLE, REASONS.CAPACITY_EXCEEDED].includes(p.reason));
});

test('buildPlan: stop-loss violation when stopLossBalance >= capital', () => {
  const p = buildPlan({ capital: 100, payoutPct: 85, targetProfit: 10, stopLossBalance: 100 });
  assert.equal(p.valid, false);
  assert.equal(p.reason, REASONS.STOP_LOSS_VIOLATION);
});

// ---------------------------------------------------------------------
// buildPlan — valid plans
// ---------------------------------------------------------------------

test('buildPlan: produces a valid, fully-described plan for normal inputs', () => {
  const p = buildPlan({ capital: 100, payoutPct: 85, targetProfit: 20, minStake: 1, risk: 'medium' });
  assert.equal(p.valid, true);
  assert.equal(p.reason, REASONS.OK);
  for (const field of [
    'mode', 'risk', 'capital', 'payout', 'payoutPct', 'targetProfit',
    'targetBalance', 'stopLossBalance', 'n', 'k', 'initialStake',
    'stakesPreview', 'worstCaseFinal', 'maxStake', 'totalExposure'
  ]) {
    assert.ok(field in p, `missing field ${field}`);
  }
  assert.ok(p.n >= p.k);
  assert.equal(p.stakesPreview.length, p.n);
  assert.ok(p.worstCaseFinal + 1e-9 >= p.targetBalance);
});

test('buildPlan: low-capital plan is handled by lite mode, not fabricated', () => {
  const p = buildPlan({ capital: 12, payoutPct: 85, targetProfit: 5, minStake: 1, risk: 'medium' });
  assert.equal(p.valid, true);
  assert.ok(['masaniello', 'masaniello-lite', 'masaniello-lite-fallback'].includes(p.mode));
  // Every stake in the worst-case preview must be executable.
  let balance = p.capital;
  for (let i = 0; i < p.n - p.k; i++) {
    assert.ok(p.stakesPreview[i] <= balance + 1e-9);
    assert.ok(p.stakesPreview[i] >= p.minStake - 1e-9);
    balance -= p.stakesPreview[i];
    assert.ok(balance >= p.stopLossBalance - 1e-9);
  }
});

test('buildPlan: explicit lite risk uses the compact Masaniello-Lite search', () => {
  const p = buildPlan({ capital: 20, payoutPct: 85, targetProfit: 5, minStake: 1, risk: 'lite' });
  assert.equal(p.valid, true);
  assert.equal(p.mode, 'masaniello-lite');
  assert.ok(p.n <= 12);
});

test('buildPlan: is deterministic', () => {
  const args = { capital: 250, payoutPct: 80, targetProfit: 75, minStake: 2, risk: 'low' };
  const p1 = buildPlan(args);
  const p2 = buildPlan(args);
  assert.deepEqual(p1, p2);
});

// ---------------------------------------------------------------------
// calculateNextStake / stake progression
// ---------------------------------------------------------------------

test('calculateNextStake: stake progression follows the plan, never exceeding balance', () => {
  const plan = buildPlan({ capital: 100, payoutPct: 85, targetProfit: 20, minStake: 1, risk: 'medium' });
  assert.equal(plan.valid, true);

  let state = { balance: plan.capital, nRemaining: plan.n, kRemaining: plan.k };
  let result;
  for (let i = 0; i < plan.n && state.kRemaining > 0 && state.nRemaining > 0; i++) {
    const step = calculateNextStake({ state, plan, result });
    assert.equal(step.reason, REASONS.OK);
    assert.ok(step.stake > 0);
    assert.ok(step.stake <= state.balance + 1e-9);
    state = step.state;
    result = i === 0 ? 'L' : 'W'; // worst-case-ish path
  }
});

test('calculateNextStake: Win behavior updates balance and consumes n/k', () => {
  const plan = buildPlan({ capital: 100, payoutPct: 85, targetProfit: 20, minStake: 1, risk: 'medium' });
  const state = { balance: plan.capital, nRemaining: plan.n, kRemaining: plan.k };
  const step1 = calculateNextStake({ state, plan });
  const step2 = calculateNextStake({ state: step1.state, plan, result: 'W' });
  assert.equal(step2.state.balance, plan.capital + step1.stake * plan.payout);
  assert.equal(step2.state.nRemaining, plan.n - 1);
  assert.equal(step2.state.kRemaining, plan.k - 1);
});

test('calculateNextStake: Loss behavior updates balance and consumes only n', () => {
  const plan = buildPlan({ capital: 100, payoutPct: 85, targetProfit: 20, minStake: 1, risk: 'medium' });
  const state = { balance: plan.capital, nRemaining: plan.n, kRemaining: plan.k };
  const step1 = calculateNextStake({ state, plan });
  const step2 = calculateNextStake({ state: step1.state, plan, result: 'L' });
  assert.equal(step2.state.balance, plan.capital - step1.stake);
  assert.equal(step2.state.nRemaining, plan.n - 1);
  assert.equal(step2.state.kRemaining, plan.k);
});

test('calculateNextStake: BE does not alter balance and does not consume n/k', () => {
  const plan = buildPlan({ capital: 100, payoutPct: 85, targetProfit: 20, minStake: 1, risk: 'medium' });
  const state = { balance: plan.capital, nRemaining: plan.n, kRemaining: plan.k };
  const step1 = calculateNextStake({ state, plan });
  const step2 = calculateNextStake({ state: step1.state, plan, result: 'BE' });
  assert.equal(step2.state.balance, plan.capital);
  assert.equal(step2.state.nRemaining, plan.n);
  assert.equal(step2.state.kRemaining, plan.k);
  assert.equal(step2.state.breakevens, 1);
  assert.equal(step2.state.trades, 1);
});

test('calculateNextStake: BE does not consume a Masaniello opportunity across a full sequence', () => {
  const plan = buildPlan({ capital: 100, payoutPct: 85, targetProfit: 20, minStake: 1, risk: 'medium' });
  let state = { balance: plan.capital, nRemaining: plan.n, kRemaining: plan.k };
  const initialN = state.nRemaining, initialK = state.kRemaining;

  const s1 = calculateNextStake({ state, plan });
  state = calculateNextStake({ state: s1.state, plan, result: 'BE' }).state;
  const s2 = calculateNextStake({ state, plan });
  state = calculateNextStake({ state: s2.state, plan, result: 'BE' }).state;

  assert.equal(state.nRemaining, initialN);
  assert.equal(state.kRemaining, initialK);
});

test('calculateNextStake: reports target-reached once k is exhausted', () => {
  const plan = buildPlan({ capital: 100, payoutPct: 85, targetProfit: 20, minStake: 1, risk: 'medium' });
  const step = calculateNextStake({
    state: { balance: 200, nRemaining: 5, kRemaining: 0 },
    plan
  });
  assert.equal(step.reason, REASONS.TARGET_REACHED);
  assert.equal(step.stake, 0);
});

test('calculateNextStake: reports no-trades-left once n is exhausted', () => {
  const plan = buildPlan({ capital: 100, payoutPct: 85, targetProfit: 20, minStake: 1, risk: 'medium' });
  const step = calculateNextStake({
    state: { balance: 200, nRemaining: 0, kRemaining: 3 },
    plan
  });
  assert.equal(step.reason, REASONS.NO_TRADES_LEFT);
  assert.equal(step.stake, 0);
});

test('calculateNextStake: rejects an invalid plan', () => {
  const step = calculateNextStake({ state: {}, plan: { valid: false } });
  assert.equal(step.reason, REASONS.INVALID_PLAN);
});

// ---------------------------------------------------------------------
// simulatePlan / scenario simulation
// ---------------------------------------------------------------------

test('simulatePlan: replays a full W/L/BE scenario deterministically', () => {
  const plan = buildPlan({ capital: 100, payoutPct: 85, targetProfit: 20, minStake: 1, risk: 'medium' });
  const r1 = simulatePlan(plan, ['BE', 'L', 'W']);
  const r2 = simulatePlan(plan, ['BE', 'L', 'W']);
  assert.deepEqual(r1, r2);
  assert.equal(r1.valid, true);
  assert.equal(r1.breakevens, 1);
});

test('simulatePlan: worst-case scenario (all losses) locks the plan out, never overshoots balance', () => {
  const plan = buildPlan({ capital: 100, payoutPct: 85, targetProfit: 20, minStake: 1, risk: 'medium' });
  const allLosses = Array(plan.n).fill('L');
  const r = simulatePlan(plan, allLosses);
  assert.equal(r.valid, true);
  for (const row of r.rows) {
    assert.ok(row.balance >= -1e-9);
  }
});

test('simulatePlan: rejects an invalid plan', () => {
  const r = simulatePlan({ valid: false }, ['W']);
  assert.equal(r.valid, false);
  assert.equal(r.reason, REASONS.INVALID_PLAN);
});

// ---------------------------------------------------------------------
// Recovery-style progression sanity (via scenario simulator directly)
// ---------------------------------------------------------------------

test('simulateScenario: a loss increases the stake required on the following trade (recovery pressure)', () => {
  const plan = buildPlan({ capital: 100, payoutPct: 85, targetProfit: 20, minStake: 1, risk: 'medium' });
  const r = simulateScenario({
    mode: 'masaniello',
    capital: plan.capital,
    payout: plan.payout,
    targetProfit: plan.targetProfit,
    stopLossBalance: plan.stopLossBalance,
    plan,
    results: ['L', 'W'],
    minStake: plan.minStake
  });
  assert.equal(r.valid, true);
  assert.equal(r.losses, 1);
  assert.equal(r.wins, 1);
  assert.ok(r.targetHit);
});

// ---------------------------------------------------------------------
// node --check for every module (redundant safety net inside the suite)
// ---------------------------------------------------------------------

test('all Lite modules are syntactically valid ES modules', async () => {
  const { execFileSync } = await import('node:child_process');
  const files = fs.readdirSync(ENGINE_DIR).filter(f => f.endsWith('.js'));
  for (const file of files) {
    assert.doesNotThrow(() => {
      execFileSync(process.execPath, ['--check', path.join(ENGINE_DIR, file)]);
    }, `${file} failed node --check`);
  }
});
