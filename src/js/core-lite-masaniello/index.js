/**
 * Lite-Masaniello Engine — Public API
 * =====================================
 *
 * This is the ONLY module the UI (or any external caller) should import
 * from. Everything else in this folder is an internal implementation
 * detail and may change shape; this file's exports are the stable
 * contract.
 *
 * This engine is fully independent from src/js/core/. It must never
 * import from it, and nothing in src/js/core/ may be modified to
 * support it.
 *
 * -------------------------------------------------------------------
 * PUBLIC API
 * -------------------------------------------------------------------
 *
 * buildPlan({ capital, payoutPct, targetProfit, stopLossBalance, minStake, risk })
 *   -> Plan
 *
 *   Builds a Masaniello-based plan sized for the given risk level.
 *   Automatically falls back to the compact Masaniello-Lite search
 *   (bounded N, small-capital friendly) when the normal risk-profile
 *   plan cannot be reached with the given capital/minStake, before
 *   ever declaring the request impossible.
 *
 *   Never returns a "fake valid" plan: every plan returned with
 *   valid:true has been walked trade-by-trade (worst case: all
 *   allowed losses first) to confirm every stake is >= minStake,
 *   <= balance, and never breaches stopLossBalance.
 *
 * calculateNextStake({ state, plan, result })
 *   -> { stake, reason, state }
 *
 *   Given a plan and the current session state (balance, nRemaining,
 *   kRemaining, ...), optionally applies the previous trade `result`
 *   ('W' | 'L' | 'BE') to the state, then computes the next stake.
 *   BE never changes balance and never consumes n/k.
 *
 * simulatePlan(plan, results, opts)
 *   -> Scenario simulation result (see scenario-simulator.js)
 *
 *   Deterministically replays an array of results ('W' | 'L' | 'BE')
 *   against a Plan and reports the full trade-by-trade outcome.
 *
 * simulateScenario(...) / buildStressScenario(...) / stressTestPlan(...)
 *   Re-exported for callers that need scenario/stress-test primitives
 *   directly (e.g. to build a custom stress-test UI).
 *
 * scoreRisk(...)
 *   Deterministic structural risk scoring for an already-built plan.
 *
 * -------------------------------------------------------------------
 * REASON CODES (stable, UI-facing)
 * -------------------------------------------------------------------
 *   ok                          - plan is valid / stake computed
 *   invalid-capital             - capital missing/<=0
 *   invalid-payout               - payoutPct missing/<=0
 *   invalid-risk                - risk not one of low|medium|high|lite
 *   invalid-target               - targetProfit missing/<=0
 *   minimum-stake-violation      - minStake alone cannot fit within capacity
 *   capacity-exceeded            - required stakes exceed what capital allows
 *   insufficient-balance         - balance too low to continue the plan
 *   target-impossible            - no reachable (n,k) exists for these inputs
 *   stop-loss-violation          - a required stake would breach stopLossBalance
 *   target-reached                - (calculateNextStake) plan already hit target
 *   no-trades-left                - (calculateNextStake) plan already exhausted
 *   invalid-plan                  - (calculateNextStake/simulatePlan) plan invalid
 */

import {
  computePlan,
  buildLitePlan,
  masanielloStake,
  guaranteedWorstCaseFinal
} from './masaniello-plan-engine.js';

import { applyTradeOutcome } from './session.js';
import { simulateScenario, parseScenario } from './scenario-simulator.js';
import { buildStressScenario, stressTestPlan } from './stress-testing.js';
import { scoreRisk } from './risk-engine.js';
import { normalizePayout, isValidPayout, payoutPercent } from './payout.js';

export const REASONS = Object.freeze({
  OK: 'ok',
  INVALID_CAPITAL: 'invalid-capital',
  INVALID_PAYOUT: 'invalid-payout',
  INVALID_RISK: 'invalid-risk',
  INVALID_TARGET: 'invalid-target',
  MIN_STAKE_VIOLATION: 'minimum-stake-violation',
  CAPACITY_EXCEEDED: 'capacity-exceeded',
  INSUFFICIENT_BALANCE: 'insufficient-balance',
  TARGET_IMPOSSIBLE: 'target-impossible',
  STOP_LOSS_VIOLATION: 'stop-loss-violation',
  TARGET_REACHED: 'target-reached',
  NO_TRADES_LEFT: 'no-trades-left',
  INVALID_PLAN: 'invalid-plan'
});

const RISK_LEVELS = ['low', 'medium', 'high', 'lite'];

// Internal reasons produced by masanielloStake() -> stable public reasons.
const STAKE_REASON_MAP = Object.freeze({
  'target-impossible': REASONS.TARGET_IMPOSSIBLE,
  'target-reached': REASONS.TARGET_REACHED,
  'no-trades-left': REASONS.NO_TRADES_LEFT,
  'invalid-payout': REASONS.INVALID_PAYOUT,
  'balance-depleted': REASONS.INSUFFICIENT_BALANCE,
  'insufficient-balance': REASONS.INSUFFICIENT_BALANCE,
  ok: REASONS.OK
});

function mapStakeReason(reason) {
  return STAKE_REASON_MAP[reason] || REASONS.CAPACITY_EXCEEDED;
}

function invalidPlan(reason, extra = {}) {
  return { valid: false, reason, ...extra };
}

/**
 * Build an independent, deterministic Masaniello-Lite plan.
 *
 * Never fabricates a valid plan: an (n, k) is only accepted after every
 * one of its worst-case stakes has been proven to be >= minStake,
 * <= the running balance, and to never breach stopLossBalance.
 */
export function buildPlan({
  capital,
  payoutPct,
  targetProfit,
  stopLossBalance = 0,
  minStake = 1,
  risk = 'medium'
} = {}) {
  const base = { capital, payoutPct, targetProfit, stopLossBalance, minStake, risk };

  if (!Number.isFinite(capital) || capital <= 0) {
    return invalidPlan(REASONS.INVALID_CAPITAL, base);
  }
  if (!Number.isFinite(payoutPct) || payoutPct <= 0) {
    return invalidPlan(REASONS.INVALID_PAYOUT, base);
  }
  if (!RISK_LEVELS.includes(risk)) {
    return invalidPlan(REASONS.INVALID_RISK, base);
  }
  if (!Number.isFinite(targetProfit) || targetProfit <= 0) {
    return invalidPlan(REASONS.INVALID_TARGET, base);
  }
  if (!Number.isFinite(minStake) || minStake <= 0) {
    return invalidPlan(REASONS.MIN_STAKE_VIOLATION, base);
  }
  if (
    !Number.isFinite(stopLossBalance) ||
    stopLossBalance < 0 ||
    stopLossBalance >= capital
  ) {
    return invalidPlan(REASONS.STOP_LOSS_VIOLATION, base);
  }
  if (minStake > capital - stopLossBalance) {
    // The minimum stake alone can never be placed without breaching
    // the stop-loss capacity — no plan can ever be built.
    return invalidPlan(REASONS.MIN_STAKE_VIOLATION, base);
  }

  const Q = 1 + payoutPct / 100;
  const targetBalance = capital + targetProfit;

  let n, k, mode;

  if (risk === 'lite') {
    const lite = buildLitePlan({ capital, payoutPct, targetProfit, floor: minStake, maxN: 12 });
    if (!lite) return invalidPlan(REASONS.TARGET_IMPOSSIBLE, base);
    n = lite.n;
    k = lite.k;
    mode = 'masaniello-lite';
  } else {
    const computed = computePlan(risk, capital, payoutPct, targetProfit, minStake);
    if (computed) {
      n = computed.n;
      k = computed.k;
      mode = 'masaniello';
    } else {
      // Normal risk-profile search couldn't reach the target (typically a
      // low-capital case) — fall back to the compact Lite search instead
      // of declaring the plan impossible outright.
      const lite = buildLitePlan({ capital, payoutPct, targetProfit, floor: minStake, maxN: 12 });
      if (!lite) return invalidPlan(REASONS.TARGET_IMPOSSIBLE, base);
      n = lite.n;
      k = lite.k;
      mode = 'masaniello-lite-fallback';
    }
  }

  const worstCaseFinal = guaranteedWorstCaseFinal(capital, n, k, Q);
  if (!Number.isFinite(worstCaseFinal)) {
    return invalidPlan(REASONS.TARGET_IMPOSSIBLE, { ...base, n, k, mode });
  }
  if (worstCaseFinal + 1e-9 < targetBalance) {
    return invalidPlan(REASONS.TARGET_IMPOSSIBLE, {
      ...base, n, k, mode, worstCaseFinal, targetBalance
    });
  }

  // Walk the worst-case path (all n-k allowed losses first, then the
  // required wins) to prove every stake is actually executable.
  const stakesPreview = [];
  let balance = capital;
  let nRemaining = n;
  let kRemaining = k;
  let maxStake = 0;
  let totalExposure = 0;

  while (nRemaining > 0 && kRemaining > 0) {
    const step = masanielloStake(balance, nRemaining, kRemaining, Q, minStake, n, k);

    if (step.reason !== 'ok' || !(step.stake > 0)) {
      return invalidPlan(mapStakeReason(step.reason), {
        ...base, n, k, mode, worstCaseFinal, targetBalance
      });
    }
    if (step.stake < minStake - 1e-9) {
      return invalidPlan(REASONS.MIN_STAKE_VIOLATION, {
        ...base, n, k, mode, worstCaseFinal, targetBalance
      });
    }
    if (step.stake > balance + 1e-9) {
      return invalidPlan(REASONS.CAPACITY_EXCEEDED, {
        ...base, n, k, mode, worstCaseFinal, targetBalance
      });
    }
    if (balance - step.stake < stopLossBalance - 1e-9) {
      return invalidPlan(REASONS.STOP_LOSS_VIOLATION, {
        ...base, n, k, mode, worstCaseFinal, targetBalance
      });
    }

    stakesPreview.push(step.stake);
    maxStake = Math.max(maxStake, step.stake);
    totalExposure += step.stake;

    if (stakesPreview.length <= n - k) {
      balance -= step.stake;
      nRemaining -= 1;
    } else {
      balance += step.stake * (Q - 1);
      nRemaining -= 1;
      kRemaining -= 1;
    }
  }

  return {
    valid: true,
    reason: REASONS.OK,
    mode,
    risk,
    capital,
    payout: Q - 1,
    payoutPct,
    targetProfit,
    targetBalance,
    stopLossBalance,
    minStake,
    n,
    k,
    losses: n - k,
    initialStake: stakesPreview[0] ?? 0,
    stakesPreview,
    worstCaseFinal,
    maxStake,
    totalExposure
  };
}

/**
 * Compute the next stake for a running plan, optionally applying the
 * previous trade's result to the given state first.
 *
 * state: { balance, nRemaining, kRemaining, streakLoss?, wins?, losses?,
 *          breakevens?, trades? }
 * result: 'W' | 'L' | 'BE' | undefined (previous outcome, if any)
 */
export function calculateNextStake({ state, plan, result } = {}) {
  if (!plan || plan.valid === false) {
    return { stake: 0, reason: REASONS.INVALID_PLAN, state };
  }

  let nextState = state;
  if (result) {
    if (!['W', 'L', 'BE'].includes(result)) {
      return { stake: 0, reason: 'invalid-result', state };
    }
    nextState = applyTradeOutcome(
      state,
      result,
      Number(state.lastStake) || 0,
      plan.payout
    );
  }

  const nRemaining = Number(nextState.nRemaining);
  const kRemaining = Number(nextState.kRemaining);

  if (kRemaining <= 0) {
    return { stake: 0, reason: REASONS.TARGET_REACHED, state: nextState };
  }
  if (nRemaining <= 0) {
    return { stake: 0, reason: REASONS.NO_TRADES_LEFT, state: nextState };
  }

  const step = masanielloStake(
    Number(nextState.balance),
    nRemaining,
    kRemaining,
    1 + plan.payout,
    plan.minStake,
    plan.n,
    plan.k
  );

  return {
    stake: step.stake,
    reason: mapStakeReason(step.reason),
    state: { ...nextState, lastStake: step.stake }
  };
}

/**
 * Deterministically replay an array of results against a plan.
 */
export function simulatePlan(plan, results, opts = {}) {
  if (!plan || plan.valid === false) {
    return { valid: false, reason: REASONS.INVALID_PLAN, rows: [] };
  }
  return simulateScenario({
    mode: 'masaniello',
    capital: plan.capital,
    payout: plan.payout,
    targetProfit: plan.targetProfit,
    stopLossBalance: plan.stopLossBalance,
    plan,
    results,
    minStake: plan.minStake,
    ...opts
  });
}

// Re-exported primitives for advanced/direct use by the UI layer.
export {
  simulateScenario,
  parseScenario,
  buildStressScenario,
  stressTestPlan,
  scoreRisk,
  normalizePayout,
  isValidPayout,
  payoutPercent
};
