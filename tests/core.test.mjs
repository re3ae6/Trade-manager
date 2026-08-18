import test from 'node:test';
import assert from 'node:assert/strict';
import { computePlan, guaranteedWorstCaseFinal, masanielloStake } from '../src/js/core/masaniello.js';
import { calculateSimpleNextStake } from '../src/js/core/simple.js';
import { computeHistoryWithCumulativeStats, buildHistoryCSV } from '../src/js/core/history.js';
import { resolvePlanTarget, computeTradingPlanStats, computeTradingPlanRiskOptions, migrateTradingPlan } from '../src/js/core/trading-plan.js';
import { computePerformanceStats } from '../src/js/core/analytics.js';
import { csvEscape } from '../src/js/core/format.js';
import { applyTradeOutcome, replayTradeResults, sessionEndAction } from '../src/js/core/session.js';
import { computeSessionStatistics } from '../src/js/core/session-statistics.js';
import { parseScenario, simulateScenario } from '../src/js/core/scenario-simulator.js';
import { scoreRisk } from '../src/js/core/risk-engine.js';
import { calculateRecoveryStake, simulateRecoverySequence } from '../src/js/core/recovery.js';
import { compareStrategies } from '../src/js/core/strategy-comparison.js';
import { buildStressScenario, stressTestPlan, stressTestRecovery } from '../src/js/core/stress-testing.js';


test('Masaniello stake respects forced-win state', () => {
  assert.deepEqual(masanielloStake(100, 2, 2, 1.85, 1, 5, 5), { stake: 100, reason: 'ok' });
});

test('Masaniello rejects impossible state', () => {
  assert.deepEqual(masanielloStake(100, 2, 3, 1.85, 1, 5, 5), { stake: 0, reason: 'target-impossible' });
});

test('Masaniello plan is deterministic for the same inputs', () => {
  const a = computePlan('medium', 1000, 85, 50, 1);
  const b = computePlan('medium', 1000, 85, 50, 1);
  assert.deepEqual(a, b);
  assert.ok(a && a.n >= a.k);
  assert.ok(guaranteedWorstCaseFinal(1000, a.n, a.k, 1.85) >= 1050 - 1e-9);
});

test('Simple sizing preserves the original stop-loss guard', () => {
  assert.deepEqual(
    calculateSimpleNextStake({ payout: 0.85, targetProfit: 10, streakLoss: 0, floor: 1, balance: 100, stopLossBalance: 80 }),
    { stake: 11.764705882352942, reason: 'ok' }
  );
});

test('History cumulative stats preserve trend threshold', () => {
  const result = computeHistoryWithCumulativeStats([
    { session: 1, wins: 1, trades: 2 },
    { session: 2, wins: 2, trades: 2 }
  ]);
  assert.equal(result[0].cumulativeWinRate, 50);
  assert.equal(result[0].trend, 'flat');
  assert.equal(result[1].cumulativeWinRate, 75);
  assert.equal(result[1].trend, 'up');
});


test('Trading plan migration normalizes legacy and fractional payout values', () => {
  const legacy = migrateTradingPlan({
    status: 'running',
    planStartBalance: 1000,
    targetBalance: 1050,
    payoutPercent: 85,
    riskOptions: [{ risk: 'old' }]
  }, 92);

  const fractional = migrateTradingPlan({
    status: 'running',
    planStartBalance: 1000,
    targetBalance: 1050,
    payoutPercent: 0.85,
    riskOptions: [{ risk: 'old' }]
  }, 92);

  assert.equal(legacy.payoutPercent, 85);
  assert.equal(fractional.payoutPercent, 85);

  assert.deepEqual(
    legacy.riskOptions.map(o => o.risk),
    ['low', 'medium', 'high']
  );

  assert.deepEqual(
    fractional.riskOptions.map(o => o.risk),
    ['low', 'medium', 'high']
  );
});

test('Trading plan migration falls back for missing or invalid payout', () => {
  const missing = migrateTradingPlan({
    status: 'running',
    planStartBalance: 1000,
    targetBalance: 1050
  }, 92);

  const invalid = migrateTradingPlan({
    status: 'running',
    planStartBalance: 1000,
    targetBalance: 1050,
    payoutPercent: 101
  }, 92);

  const ambiguous = migrateTradingPlan({
    status: 'running',
    planStartBalance: 1000,
    targetBalance: 1050,
    payoutPercent: 1.01
  }, 92);

  assert.equal(missing.payoutPercent, 92);
  assert.equal(invalid.payoutPercent, 92);
  assert.equal(ambiguous.payoutPercent, 92);
});

test('Trading plan migration rejects an invalid fallback instead of inventing payout', () => {
  const plan = migrateTradingPlan({
    status: 'running',
    planStartBalance: 1000,
    targetBalance: 1050,
    payoutPercent: 101
  }, 101);

  assert.equal(plan.payoutPercent, null);
  assert.equal(plan.riskOptions, null);
});

test('Trading plan migration rebuilds stale derived risk options', () => {
  const plan = migrateTradingPlan({
    status: 'running',
    planStartBalance: 1000,
    targetBalance: 1050,
    payoutPercent: 85,
    riskOptions: [
      { risk: 'corrupt', n: 999, k: 999 }
    ]
  }, 92);

  assert.deepEqual(
    plan.riskOptions.map(o => o.risk),
    ['low', 'medium', 'high']
  );

  assert.notEqual(plan.riskOptions[0].n, 999);
});

test('Trading plan migration leaves non-running plans unchanged', () => {
  const completed = {
    status: 'completed',
    payoutPercent: 0.85,
    riskOptions: [{ risk: 'historical' }]
  };

  assert.deepEqual(migrateTradingPlan(completed, 92), completed);
});

test('Trading plan target resolution preserves percent/balance semantics', () => {
  assert.deepEqual(resolvePlanTarget(1000, 10, NaN), { targetPercent: 10, targetBalance: 1100 });
  assert.ok(Math.abs(resolvePlanTarget(1000, NaN, 1200).targetPercent - 20) < 1e-12);
});

test('Trading plan stats remain pure', () => {
  const plan = { planStartBalance: 1000, targetBalance: 1200, planCreatedAt: '2026-01-01T00:00:00.000Z' };
  const sessions = [{ endedAt: '2026-01-02T00:00:00.000Z', profit: 50 }];
  const stats = computeTradingPlanStats(plan, sessions, 1050);
  assert.equal(stats.sessionsCompletedTowardPlan, 1);
  assert.equal(stats.averageProfitPerCompletedSession, 50);
  assert.equal(stats.remainingProfit, 150);
});


test('history CSV includes the re3ae6 signature row', () => {
  const csv = buildHistoryCSV([{
    session: 1, mode: 'simple', trades: 2, wins: 1, losses: 1,
    initial: 100, finalBalance: 99, profit: -1, date: '2026-08-10T00:00:00.000Z'
  }]);
  assert.match(csv, /\r?\nre3ae6$/);
  assert.doesNotMatch(csv, /Signature/);
});


test('History CSV header is clean UTF-8 text without a BOM marker', () => {
  const csv = buildHistoryCSV([{
    session: 1, mode: 'simple', trades: 1, wins: 1, losses: 0,
    initial: 100, finalBalance: 101, profit: 1, date: '2026-08-10T00:00:00.000Z'
  }]);
  assert.equal(csv.split('\r\n')[0].split(',')[0], 'Session');
  assert.equal(csv.charCodeAt(0), 'S'.charCodeAt(0));
  assert.doesNotMatch(csv, /ï»¿/);
});


test('Trading plan risk options produce low, medium and high plans from the saved target', () => {
  const options = computeTradingPlanRiskOptions(1000, 1050, 85, 1);
  assert.deepEqual(options.map(o => o.risk), ['low','medium','high']);
  assert.ok(options.every(o => Number.isInteger(o.n) && Number.isInteger(o.k) && o.n >= o.k));
  assert.ok(options[0].n >= options[1].n);
  assert.ok(options[1].n >= options[2].n);
});


test('Performance dashboard aggregates wins, losses, BE and profit', () => {
  const stats = computePerformanceStats([
    { session: 1, trades: 4, wins: 2, losses: 1, breakevens: 1, initial: 100, finalBalance: 110, profit: 10 },
    { session: 2, trades: 3, wins: 1, losses: 2, breakevens: 0, initial: 110, finalBalance: 105, profit: -5 }
  ]);
  assert.equal(stats.sessions, 2);
  assert.equal(stats.trades, 7);
  assert.equal(stats.wins, 3);
  assert.equal(stats.losses, 3);
  assert.equal(stats.breakevens, 1);
  assert.equal(stats.winRate, (3 / 7) * 100);
  assert.equal(stats.netProfit, 5);
  assert.equal(stats.bestSession.profit, 10);
  assert.equal(stats.worstSession.profit, -5);
  assert.equal(stats.maxDrawdownDollar, 5);
  assert.equal(stats.maxDrawdownPercent, (5 / 110) * 100);
});

test('Performance dashboard includes the live session without changing closed history', () => {
  const stats = computePerformanceStats(
    [{ session: 1, trades: 2, wins: 1, losses: 1, breakevens: 0, finalBalance: 99, profit: -1 }],
    { trades: 2, wins: 2, losses: 0, breakevens: 0, finalBalance: 103, profit: 3 }
  );
  assert.equal(stats.completedSessions, 1);
  assert.equal(stats.sessions, 2);
  assert.equal(stats.trades, 4);
  assert.equal(stats.wins, 3);
  assert.equal(stats.netProfit, 2);
  assert.equal(stats.currentBalance, 103);
});

test('Performance dashboard handles empty history', () => {
  const stats = computePerformanceStats([]);
  assert.equal(stats.sessions, 0);
  assert.equal(stats.trades, 0);
  assert.equal(stats.winRate, 0);
  assert.equal(stats.currentBalance, null);
});


test('CSV export includes BE and keeps the requested signature only', () => {
  const csv = buildHistoryCSV([{
    session: 1, mode: 'simple', trades: 2, wins: 1, breakevens: 1, losses: 0,
    initial: 100, finalBalance: 100.85, profit: 0.85, date: '2026-01-01 12:00:00'
  }]);
  assert.match(csv, /Session,Mode,Trades,Wins,BE,Losses/);
  assert.ok(csv.trimEnd().endsWith('re3ae6'));
  assert.doesNotMatch(csv, /Signature/);
});


test('Planner returns null for targets beyond the search cap', () => {
  assert.equal(computePlan('high', 1, 0.01, 1e9, 1), null);
});

test('Masaniello rejects non-finite stake results safely', () => {
  const result = masanielloStake(Number.MAX_VALUE, 2, 1, Number.MAX_VALUE, 1, 2, 1);
  assert.deepEqual(result, { stake: 0, reason: 'target-impossible' });
});

test('CSV escaping neutralizes spreadsheet formula prefixes', () => {
  assert.equal(csvEscape('=SUM(A1:A2)'), '\t=SUM(A1:A2)');
  assert.equal(csvEscape('+123'), '\t+123');
  assert.equal(csvEscape('-123'), '\t-123');
  assert.equal(csvEscape('@cmd'), '\t@cmd');
});

import { buildMasanielloPlans, buildSimplePlans, validateMasanielloCustom, buildSimplePlan } from '../src/js/core/planner.js';

test('Planner builds three Masaniello risk options without changing engine outputs', () => {
  const plans = buildMasanielloPlans(1000, 85, 100, 1);
  assert.equal(plans.length, 3);
  assert.ok(plans.every(p => p.risk && Object.hasOwn(p,'valid')));
  assert.ok(plans.some(p => p.valid));
});

test('Masaniello custom planner validates N and allowed losses', () => {
  const result = validateMasanielloCustom(1000, 85, 100, 20, 5, 1);
  assert.equal(result.valid, true);
  assert.equal(result.n, 20);
  assert.equal(result.k, 15);
  assert.equal(result.losses, 5);
});

test('Simple planner returns risk profiles with executable stake information', () => {
  const plans = buildSimplePlans(1000, 85, 100, 1, 900);
  assert.equal(plans.length, 3);
  assert.ok(plans.every(p => Number.isFinite(p.profitPerWin)));
});

test('Simple planner expectedFinal matches targetBalance for a valid plan', () => {
  const profile = { risk: 'high', n: 10, k: 7, label: 'high' };
  const plan = buildSimplePlan(profile, 1000, 85, 100, 1, 500);
  assert.equal(plan.valid, true);
  assert.equal(plan.targetBalance, 1100);
  assert.ok(Math.abs(plan.expectedFinal - plan.targetBalance) < 1e-6);
});


test('BE is a neutral Masaniello trade without changing balance, N or K', () => {
  const state = applyTradeOutcome({ balance: 100, nRemaining: 10, kRemaining: 5, streakLoss: 0, currentStreakCount: 0 }, 'BE', 10, 0.85);
  assert.equal(state.balance, 100);
  assert.equal(state.nRemaining, 10);
  assert.equal(state.kRemaining, 5);
  assert.equal(state.trades, 1);
  assert.equal(state.breakevens, 1);
  assert.equal(state.wins, 0);
  assert.equal(state.losses, 0);
});

test('Masaniello Win and Loss update N/K correctly', () => {
  const win = applyTradeOutcome({ balance: 100, nRemaining: 10, kRemaining: 5 }, 'W', 10, 0.85);
  assert.equal(win.balance, 108.5);
  assert.equal(win.nRemaining, 9);
  assert.equal(win.kRemaining, 4);
  const loss = applyTradeOutcome({ balance: 100, nRemaining: 10, kRemaining: 5 }, 'L', 10, 0.85);
  assert.equal(loss.balance, 90);
  assert.equal(loss.nRemaining, 9);
  assert.equal(loss.kRemaining, 5);
});

test('Undo replay uses the real replay primitive for Win → Loss → BE → Loss → Undo', () => {
  const initial = { balance: 100, nRemaining: 10, kRemaining: 5, streakLoss: 0, currentStreakCount: 0, wins: 0, losses: 0, breakevens: 0, trades: 0 };
  const results = ['W','L','BE','L'];
  const stakeResolver = () => 10;

  const afterFour = replayTradeResults(initial, results, stakeResolver, 0.85);
  assert.equal(afterFour.balance, 88.5);
  assert.equal(afterFour.nRemaining, 7);
  assert.equal(afterFour.kRemaining, 4);
  assert.equal(afterFour.trades, 4);
  assert.equal(afterFour.breakevens, 1);

  // This is the same replay contract used by Undo: remove only the last
  // result, then deterministically replay every remaining real outcome.
  const afterUndo = replayTradeResults(initial, results.slice(0, -1), stakeResolver, 0.85);
  assert.equal(afterUndo.balance, 98.5);
  assert.equal(afterUndo.nRemaining, 8);
  assert.equal(afterUndo.kRemaining, 4);
  assert.equal(afterUndo.trades, 3);
  assert.equal(afterUndo.wins, 1);
  assert.equal(afterUndo.losses, 1);
  assert.equal(afterUndo.breakevens, 1);
});

test('Undo replay keeps BE neutral without consuming a Masaniello opportunity', () => {
  const initial = { balance: 100, nRemaining: 10, kRemaining: 5, streakLoss: 0, currentStreakCount: 0, wins: 0, losses: 0, breakevens: 0, trades: 0 };
  const stakeResolver = () => 10;
  const before = replayTradeResults(initial, ['W','BE'], stakeResolver, 0.85);
  const afterUndo = replayTradeResults(initial, ['W'], stakeResolver, 0.85);

  assert.equal(before.balance, 108.5);
  assert.equal(before.nRemaining, 9);
  assert.equal(before.kRemaining, 4);
  assert.equal(afterUndo.balance, 108.5);
  assert.equal(afterUndo.nRemaining, 9);
  assert.equal(afterUndo.kRemaining, 4);
  assert.equal(afterUndo.trades, 1);
  assert.equal(afterUndo.breakevens, 0);
});

test('Session end exposes all three UI decisions without mutating session state', () => {
  const choices = {
    primary: sessionEndAction('primary'),
    secondary: sessionEndAction('secondary'),
    cancel: sessionEndAction('cancel')
  };
  assert.deepEqual(choices, {
    primary: 'save-and-delete',
    secondary: 'delete-without-save',
    cancel: 'continue'
  });
});

test('Session end decision mapping is stable for unexpected dialog values', () => {
  assert.equal(sessionEndAction(undefined), 'continue');
  assert.equal(sessionEndAction('unexpected'), 'continue');
});

test('Simple planner uses the configured stop-loss balance', () => {
  const profile = { risk: 'medium', n: 15, k: 10, label: 'medium' };
  const plan = buildSimplePlan(profile, 1000, 85, 50, 1, 950);
  assert.equal(plan.valid, false);
  assert.equal(plan.reason, 'stoploss');
});

test('BE leaves Simple balance unchanged and still counts as a trade', () => {
  const state = applyTradeOutcome({ balance: 100, streakLoss: 0, currentStreakCount: 0 }, 'BE', 10, 0.85);
  assert.equal(state.balance, 100);
  assert.equal(state.trades, 1);
  assert.equal(state.breakevens, 1);
  assert.equal(state.wins, 0);
  assert.equal(state.losses, 0);
});

test('Three consecutive BE outcomes keep balance fixed and consume three trades', () => {
  let state = { balance: 100, nRemaining: 10, kRemaining: 5 };
  for(let i = 0; i < 3; i++) state = applyTradeOutcome(state, 'BE', 10, 0.85);
  assert.equal(state.balance, 100);
  assert.equal(state.trades, 3);
  assert.equal(state.breakevens, 3);
  assert.equal(state.nRemaining, 10);
  assert.equal(state.kRemaining, 5);
});

import { analyzePlan } from '../src/js/core/plan-analyzer.js';

test('Plan analyzer uses the existing Simple engine without mutating the plan', () => {
  const plan = buildSimplePlans(1000, 85, 100, 1, 500).find(p => p.risk === 'high' && p.valid);
  const before = JSON.stringify(plan);
  const result = analyzePlan({
    mode: 'simple', capital: 1000, payoutPct: 85,
    targetBalance: 1100, stopLossBalance: 500, plan, minStake: 1
  });
  assert.equal(result.valid, true);
  assert.equal(result.mode, 'simple');
  assert.ok(result.initialStake > 0);
  assert.ok(result.maxStake >= result.initialStake);
  assert.equal(result.maxLossStreak, plan.n - plan.k);
  assert.equal(result.targetReachable, true);
  assert.equal(JSON.stringify(plan), before);
});

test('Plan analyzer reports Masaniello worst case and loss stress path', () => {
  const plan = buildMasanielloPlans(1000, 85, 100, 1).find(p => p.risk === 'medium' && p.valid);
  const result = analyzePlan({
    mode: 'masaniello', capital: 1000, payoutPct: 85,
    targetBalance: 1100, stopLossBalance: 800, plan, minStake: 1
  });
  assert.equal(result.valid, true);
  assert.equal(result.maxLossStreak, plan.n - plan.k);
  assert.equal(result.worstCaseFinal, plan.worstCaseFinal);
  assert.ok(result.losses.length > 0);
  assert.ok(result.losses[0].stake > 0);
});

test('Plan analyzer flags a plan when the configured stop-loss is breached', () => {
  const plan = buildSimplePlans(1000, 85, 100, 1, 500).find(p => p.risk === 'high' && p.valid);
  const result = analyzePlan({
    mode: 'simple', capital: 1000, payoutPct: 85,
    targetBalance: 1100, stopLossBalance: 900, plan, minStake: 1
  });
  assert.equal(result.valid, true);
  assert.equal(result.stopLossSafe, false);
  assert.equal(result.status, 'warning');
});


test('Session statistics count BE in trades and reset streaks correctly', () => {
  const stats = computeSessionStatistics([
    { result:'W', balance:110 },
    { result:'L', balance:100 },
    { result:'BE', balance:100 },
    { result:'L', balance:90 },
    { result:'W', balance:99 }
  ], 100);
  assert.equal(stats.trades, 5);
  assert.equal(stats.wins, 2);
  assert.equal(stats.breakevens, 1);
  assert.equal(stats.losses, 2);
  assert.equal(stats.winRate, 40);
  assert.equal(stats.currentWinStreak, 1);
  assert.equal(stats.currentLossStreak, 0);
  assert.equal(stats.maxLossStreak, 1);
  assert.equal(stats.maxDrawdown, 20);
});

test('Scenario parser accepts arrows, commas and whitespace', () => {
  assert.deepEqual(parseScenario('W → L, BE / L'), ['W','L','BE','L']);
});

test('Simple scenario uses the real stake engine and keeps BE balance-neutral', () => {
  const result = simulateScenario({
    mode:'simple',
    capital:100,
    payout:0.85,
    targetProfit:10,
    stopLossBalance:80,
    plan:{valid:true,n:10,k:5,profitPerWin:2},
    results:['W','BE','L']
  });
  assert.equal(result.valid, true);
  assert.equal(result.trades, 3);
  assert.equal(result.breakevens, 1);
  assert.equal(result.rows[1].balance, result.rows[0].balance);
  assert.ok(result.rows[0].stake > 0);
});

test('Masaniello scenario BE keeps nRemaining and kRemaining unchanged', () => {
  const result = simulateScenario({
    mode:'masaniello',
    capital:100,
    payout:0.85,
    targetProfit:20,
    stopLossBalance:80,
    plan:{valid:true,n:10,k:5},
    results:['BE']
  });
  assert.equal(result.valid, true);
  assert.equal(result.rows[0].balance, 100);
  assert.equal(result.nRemaining, 10);
  assert.equal(result.kRemaining, 5);
});

import { buildWhatIfComparison } from '../src/js/core/what-if.js';

test('What-If comparison replays actual and hypothetical outcomes without mutating either result', () => {
  const plan = { valid:true, n:10, k:5 };
  const actual = ['W','L','BE','L','W'];
  const hypothetical = ['W','L','BE','W','W'];
  const comparison = buildWhatIfComparison({
    mode:'masaniello', capital:100, payout:85, targetProfit:20,
    targetBalance:120, stopLossBalance:80, plan,
    actualResults:actual, hypotheticalResults:hypothetical, minStake:1
  });
  assert.equal(comparison.valid, true);
  assert.notEqual(comparison.actual.finalBalance, comparison.hypothetical.finalBalance);
  assert.equal(comparison.actual.trades, 5);
  assert.equal(comparison.hypothetical.trades, 5);
  assert.equal(comparison.delta.finalBalance, comparison.hypothetical.finalBalance - comparison.actual.finalBalance);
  assert.deepEqual(actual, ['W','L','BE','L','W']);
});

test('What-If comparison rejects mismatched sequences', () => {
  const result = buildWhatIfComparison({
    mode:'simple', capital:100, payout:85, targetProfit:10,
    stopLossBalance:80, plan:{valid:true,n:10,k:5},
    actualResults:['W'], hypotheticalResults:['L','BE'], minStake:1
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'invalid-results');
});


test('Risk engine is deterministic and transparent', () => {
  const a = scoreRisk({capital:1000,targetBalance:1100,stopLossBalance:800,initialStake:11.76,maxStake:50,maxDrawdown:100,maxLossStreak:5,recoveryExposure:150});
  const b = scoreRisk({capital:1000,targetBalance:1100,stopLossBalance:800,initialStake:11.76,maxStake:50,maxDrawdown:100,maxLossStreak:5,recoveryExposure:150});
  assert.deepEqual(a,b);
  assert.ok(a.valid && a.score >= 0 && a.score <= 100);
  assert.ok(['safe','moderate','high','extreme'].includes(a.level));
});

test('Recovery is bounded and is not Martingale doubling', () => {
  const r = calculateRecoveryStake({balance:1000,payout:.85,accumulatedLoss:20,targetProfit:10,stopLossBalance:800,maxStake:50,maxDrawdown:200,drawdownUsed:20,maxAttempts:3,attemptsUsed:1,minStake:1});
  assert.equal(r.canRecover,true);
  assert.equal(r.stake,35.29);
  const blocked = calculateRecoveryStake({balance:1000,payout:.85,accumulatedLoss:100,targetProfit:10,stopLossBalance:950,maxStake:50,maxDrawdown:200,drawdownUsed:0,maxAttempts:3,attemptsUsed:0,minStake:1});
  assert.equal(blocked.canRecover,false);
  assert.equal(blocked.reason,'limit-exceeded');
});

test('Recovery resets accumulated loss after Win and keeps BE neutral', () => {
  const r = simulateRecoverySequence({capital:1000,payout:.85,targetProfit:10,stopLossBalance:800,maxStake:100,maxDrawdown:200,maxAttempts:3,results:['L','BE','W'],minStake:1});
  assert.equal(r.valid,true);
  assert.equal(r.rows[0].result,'L');
  assert.equal(r.rows[1].result,'BE');
  assert.equal(r.rows[2].result,'W');
  assert.ok(r.balance > 1000);
});

test('Strategy comparison uses the same input without rewriting existing engines', () => {
  const r = compareStrategies({capital:1000,payoutPct:85,targetBalance:1020,stopLossBalance:900,minStake:1});
  assert.equal(r.valid,true);
  assert.ok(r.rows.some(x=>x.strategy==='Simple'));
  assert.ok(r.rows.some(x=>x.strategy==='Masaniello'));
  assert.ok(r.rows.some(x=>x.strategy==='Recovery'));
});

test('Strategy comparison exposes decision-support metrics and deterministic worst case', () => {
  const r = compareStrategies({
    capital:1000, payoutPct:85, targetBalance:1100, stopLossBalance:800, minStake:1,
    scenario:['W','L','BE','W']
  });
  assert.equal(r.valid,true);
  assert.deepEqual(r.worstScenario, Array(20).fill('L'));
  for (const row of r.rows) {
    assert.ok('initialStake' in row);
    assert.ok('averageStake' in row);
    assert.ok('maxStake' in row);
    assert.ok('maxDrawdown' in row);
    assert.ok('worstCase' in row);
    assert.ok('scenario' in row);
    assert.ok(row.risk && row.risk.valid);
  }
});

test('Strategy comparison rejects invalid scenario results', () => {
  const r = compareStrategies({capital:1000,payoutPct:85,targetBalance:1100,stopLossBalance:800,scenario:['W','X']});
  assert.equal(r.valid,false);
  assert.equal(r.reason,'invalid-scenario');
});

test('Stress scenario generator is deterministic for random seed', () => {
  assert.deepEqual(buildStressScenario('random',10,42), buildStressScenario('random',10,42));
  assert.deepEqual(buildStressScenario('best',3), ['W','W','W']);
  assert.deepEqual(buildStressScenario('worst',3), ['L','L','L']);
});

test('Stress test returns best, normal, worst and random scenarios', () => {
  const plan = buildSimplePlans(1000,85,50,1,800).find(p=>p.valid);
  const r = stressTestPlan({mode:'simple',capital:1000,payout:.85,targetProfit:50,stopLossBalance:800,plan,minStake:1,seed:42,trades:8});
  assert.equal(r.valid,true);
  assert.deepEqual(r.scenarios.map(x=>x.kind), ['best','normal','worst','custom','random']);
});

test('Stress testing supports custom scenarios and configurable random probabilities', () => {
  const plan = buildSimplePlans(1000,85,50,1,800).find(p=>p.valid);
  const r = stressTestPlan({mode:'simple',capital:1000,payout:.85,targetProfit:50,stopLossBalance:800,plan,minStake:1,seed:42,trades:8,customResults:['L','BE','W'],probabilities:{win:.6,loss:.2,be:.2}});
  assert.equal(r.valid,true);
  assert.deepEqual(r.scenarios.map(x=>x.kind), ['best','normal','worst','custom','random']);
  assert.deepEqual(r.scenarios.find(x=>x.kind==='custom').results, ['L','BE','W']);
  assert.deepEqual(r.probabilities,{win:.6,loss:.2,be:.2});
  assert.deepEqual(r.scenarios.find(x=>x.kind==='random').results, buildStressScenario('random',8,42,{win:.6,loss:.2,be:.2}));
});

test('Stress testing rejects invalid random probabilities', () => {
  const plan = buildSimplePlans(1000,85,50,1,800).find(p=>p.valid);
  const r = stressTestPlan({mode:'simple',capital:1000,payout:.85,targetProfit:50,stopLossBalance:800,plan,probabilities:{win:.6,loss:.6,be:0}});
  assert.equal(r.valid,false);
  assert.equal(r.reason,'invalid-probabilities');
});

test('Recovery stress testing includes custom and random scenarios', () => {
  const r = stressTestRecovery({capital:1000,payout:.85,targetProfit:20,stopLossBalance:800,maxStake:100,maxDrawdown:200,maxAttempts:3,minStake:1,seed:42,trades:6,customResults:['L','BE','W'],probabilities:{win:.5,loss:.3,be:.2}});
  assert.equal(r.valid,true);
  assert.deepEqual(r.scenarios.map(x=>x.kind), ['best','normal','worst','custom','random']);
});

test('BE remains a real trade in scenario stress metrics', () => {
  const plan = buildSimplePlans(1000,85,20,1,900).find(p=>p.valid);
  const r = simulateScenario({mode:'simple',capital:1000,payout:.85,targetProfit:20,stopLossBalance:900,plan,results:['BE','BE'],minStake:1});
  assert.equal(r.trades,2);
  assert.equal(r.breakevens,2);
  assert.equal(r.winRate,0);
  assert.equal(r.finalBalance,1000);
});


test('Stress test scenarios expose targetHit and stopLossHit on the simulation result', () => {
  const plan = buildSimplePlans(1000,85,50,1,800).find(p=>p.valid);
  const r = stressTestPlan({mode:'simple',capital:1000,payout:.85,targetProfit:50,stopLossBalance:800,plan,minStake:1,seed:42,trades:8});
  const best = r.scenarios.find(x=>x.kind==='best').simulation;
  const worst = r.scenarios.find(x=>x.kind==='worst').simulation;
  assert.equal(best.targetHit, true);
  assert.equal(worst.stopLossHit, true);
});

test('simulateScenario reports targetHit false and stopLossHit false when neither condition is met', () => {
  const plan = buildSimplePlans(1000,85,50,1,800).find(p=>p.valid);
  const r = simulateScenario({mode:'simple',capital:1000,payout:.85,targetProfit:50,stopLossBalance:800,plan,results:['W'],minStake:1});
  assert.equal(r.targetHit, false);
  assert.equal(r.stopLossHit, false);
});

test('Simple mode keeps risk recommendation cards visible and landscape grid reserves the long-term column', async () => {
  const fs = await import('node:fs/promises');
  const css = await fs.readFile(new URL('../src/css/app.css', import.meta.url), 'utf8');
  assert.equal(css.includes('#panelSimple .simple-planner-block{display:none}'), false);
  assert.match(css, /grid-template-columns:1\.4fr 1fr \.8fr 1fr;/);
  assert.match(css, /\.grid > \.calc-column\[data-section-panel=\"longterm\"\]\{\s*grid-column:4;/);
});

test('Service Worker app shell caches all runtime core modules and uses current cache version', async () => {
  const fs = await import('node:fs/promises');
  const sw = await fs.readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  for (const path of [
    './src/js/core/session.js',
    './src/js/core/risk-engine.js',
    './src/js/core/recovery.js',
    './src/js/core/strategy-comparison.js',
    './src/js/core/stress-testing.js',
    './src/js/core/payout.js'
  ]) {
    assert.ok(sw.includes(path), `missing offline app-shell asset: ${path}`);
  }
  assert.match(sw, /CACHE_VERSION = 'v2\.10\.19'/);
});


test('Risk engine is deterministic and exposes its policy', () => {
  const input = {
    capital: 1000,
    targetBalance: 1100,
    stopLossBalance: 900,
    initialStake: 20,
    maxStake: 100,
    maxDrawdown: 80,
    maxLossStreak: 3,
    recoveryExposure: 120
  };
  const a = scoreRisk(input);
  const b = scoreRisk(input);
  assert.deepEqual(a, b);
  assert.equal(a.valid, true);
  assert.equal(a.policy.scoreMax, 100);
  assert.equal(a.methodology.includes('not a market-risk probability'), true);
});

test('Risk engine includes loss streak in the structural score', () => {
  const low = scoreRisk({ capital: 1000, targetBalance: 1050, stopLossBalance: 950, initialStake: 5, maxStake: 5, maxDrawdown: 10, maxLossStreak: 0 });
  const high = scoreRisk({ capital: 1000, targetBalance: 1050, stopLossBalance: 950, initialStake: 5, maxStake: 5, maxDrawdown: 10, maxLossStreak: 10 });
  assert.ok(high.score > low.score);
  assert.ok(high.warnings.some(w => w.includes('باخت پیاپی')));
});

test('Risk engine supports an explicit policy without changing the default engine', () => {
  const result = scoreRisk({
    capital: 1000,
    targetBalance: 1050,
    stopLossBalance: 900,
    initialStake: 10,
    maxStake: 200,
    maxDrawdown: 50,
    policy: {
      maxStakePctLimit: 10,
      bands: { safeMax: 20, moderateMax: 40, highMax: 60 }
    }
  });
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some(w => w.includes('بیشینه Stake')));
  assert.ok(['safe','moderate','high','extreme'].includes(result.level));
});


test('Recovery refuses a minimum stake that exceeds available recovery capacity', () => {
  const r = calculateRecoveryStake({
    balance: 100,
    payout: 0.85,
    accumulatedLoss: 0,
    targetProfit: 0,
    stopLossBalance: 95,
    maxStake: 50,
    maxDrawdown: 10,
    drawdownUsed: 0,
    maxAttempts: 3,
    attemptsUsed: 0,
    minStake: 10
  });
  assert.equal(r.valid, true);
  assert.equal(r.canRecover, false);
  assert.equal(r.reason, 'minimum-stake-exceeds-capacity');
});

test('Recovery enforces maximum attempts before sizing a new stake', () => {
  const r = calculateRecoveryStake({
    balance: 1000,
    payout: 0.85,
    accumulatedLoss: 20,
    targetProfit: 10,
    stopLossBalance: 800,
    maxStake: 100,
    maxDrawdown: 200,
    drawdownUsed: 20,
    maxAttempts: 2,
    attemptsUsed: 2,
    minStake: 1
  });
  assert.equal(r.valid, true);
  assert.equal(r.canRecover, false);
  assert.equal(r.reason, 'max-attempts');
});

test('Recovery blocks a stake that would cross the stop-loss balance', () => {
  const r = calculateRecoveryStake({
    balance: 100,
    payout: 0.85,
    accumulatedLoss: 10,
    targetProfit: 10,
    stopLossBalance: 95,
    maxStake: 100,
    maxDrawdown: Infinity,
    drawdownUsed: 0,
    maxAttempts: 3,
    attemptsUsed: 0,
    minStake: 1
  });
  assert.equal(r.valid, true);
  assert.equal(r.canRecover, false);
  assert.equal(r.reason, 'limit-exceeded');
});

test('Recovery resets after Win and does not charge Balance for BE', () => {
  const r = simulateRecoverySequence({
    capital: 1000,
    payout: 0.85,
    targetProfit: 10,
    stopLossBalance: 800,
    maxStake: 100,
    maxDrawdown: 200,
    maxAttempts: 3,
    results: ['L','BE','W'],
    minStake: 1
  });
  assert.equal(r.valid, true);
  assert.equal(r.rows[1].balance, r.rows[0].balance);
  assert.ok(r.rows[2].profit > 0);
  assert.ok(r.balance > 1000);
});

test('Advanced analytics aggregates BE rate, profit factor and stored stake metrics', () => {
  const stats = computePerformanceStats([
    {
      session: 1, trades: 4, wins: 2, losses: 1, breakevens: 1,
      initial: 100, finalBalance: 110, profit: 10,
      winProfit: 20, lossAmount: 10,
      averageStake: 8, maxStake: 12, maxLossStreak: 1, maxWinStreak: 2
    },
    {
      session: 2, trades: 2, wins: 1, losses: 1, breakevens: 0,
      initial: 110, finalBalance: 115, profit: 5,
      winProfit: 15, lossAmount: 10,
      averageStake: 10, maxStake: 14, maxLossStreak: 1, maxWinStreak: 1
    }
  ]);
  assert.equal(stats.beRate, (1 / 6) * 100);
  assert.equal(stats.lossRate, (2 / 6) * 100);
  assert.equal(stats.profitFactor, 35 / 20);
  assert.equal(stats.averageStake, (8 * 4 + 10 * 2) / 6);
  assert.equal(stats.maxStake, 14);
  assert.equal(stats.maxLossStreak, 1);
  assert.equal(stats.maxWinStreak, 2);
});

test('Profit factor is live-aware-safe: closed 8W/2L + live 1W/4L uses only closed dollar amounts', () => {
  const history = [];
  for(let i = 0; i < 8; i++) history.push({ session: i, trades: 1, wins: 1, losses: 0, breakevens: 0, initial: 100, finalBalance: 100, profit: 0, winProfit: 62.5, lossAmount: 0 });
  for(let i = 0; i < 2; i++) history.push({ session: i + 8, trades: 1, wins: 0, losses: 1, breakevens: 0, initial: 100, finalBalance: 100, profit: 0, winProfit: 0, lossAmount: 50 });
  const live = { trades: 5, wins: 1, losses: 4, breakevens: 0, initial: 100, finalBalance: 100, profit: 0 };
  const stats = computePerformanceStats(history, live);
  assert.equal(stats.profitFactor, 5);
});

test('Profit factor: closed sessions only, unaffected by absent live session', () => {
  const stats = computePerformanceStats([
    { session: 1, trades: 4, wins: 2, losses: 1, breakevens: 1, initial: 100, finalBalance: 110, profit: 10, winProfit: 20, lossAmount: 10, averageStake: 8, maxStake: 12, maxLossStreak: 1, maxWinStreak: 2 },
    { session: 2, trades: 2, wins: 1, losses: 1, breakevens: 0, initial: 110, finalBalance: 115, profit: 5, winProfit: 15, lossAmount: 10, averageStake: 10, maxStake: 14, maxLossStreak: 1, maxWinStreak: 1 }
  ], null);
  assert.equal(stats.profitFactor, 35 / 20);
});

test('Profit factor: zero sessions returns 0', () => {
  const stats = computePerformanceStats([], null);
  assert.equal(stats.profitFactor, 0);
});

test('Profit factor: only a live session (no closed history) returns 0', () => {
  const live = { trades: 5, wins: 1, losses: 4, breakevens: 0, initial: 100, finalBalance: 100, profit: 0 };
  const stats = computePerformanceStats([], live);
  assert.equal(stats.profitFactor, 0);
});

test('Profit factor: all-win closed session (grossLoss = 0) returns Infinity', () => {
  const stats = computePerformanceStats([
    { session: 1, trades: 3, wins: 3, losses: 0, breakevens: 0, initial: 100, finalBalance: 130, profit: 30, winProfit: 30, lossAmount: 0 }
  ], null);
  assert.equal(stats.profitFactor, Infinity);
});

test('Advanced analytics stays backward-compatible with old session history', () => {
  const stats = computePerformanceStats([
    { session: 1, trades: 2, wins: 1, losses: 1, breakevens: 0, initial: 100, finalBalance: 99, profit: -1 }
  ]);
  assert.equal(stats.averageStake, null);
  assert.equal(stats.maxStake, null);
  assert.equal(stats.maxLossStreak, null);
  assert.equal(stats.maxWinStreak, null);
});


test('Release audit keeps a user-facing runtime error guard in app source', async () => {
  const fs = await import('node:fs/promises');
  const appSource = await fs.readFile(new URL('../src/js/app.js', import.meta.url), 'utf8');
  assert.match(appSource, /window\.addEventListener\('error'/);
  assert.match(appSource, /window\.addEventListener\('unhandledrejection'/);
  assert.match(appSource, /یک خطای غیرمنتظره رخ داد/);
  assert.match(appSource, /یک عملیات غیرمنتظره کامل نشد/);
});

import { PAYOUT_MIN, PAYOUT_MAX, normalizePayout, isValidPayout, payoutPercent } from '../src/js/core/payout.js';

test('Payout contract uses a normalized fraction from 0 to 1', () => {
  assert.equal(normalizePayout(0.85), 0.85);
  assert.equal(normalizePayout(0.92), 0.92);
  assert.equal(normalizePayout(1), 1);
  assert.equal(normalizePayout(85), 0.85);
  assert.equal(normalizePayout(92), 0.92);
  assert.equal(payoutPercent(0.85), 85);
});

test('Payout contract rejects zero, negatives and values above 100%', () => {
  assert.equal(PAYOUT_MIN, 0.01);
  assert.equal(PAYOUT_MAX, 1);
  assert.equal(isValidPayout(0.85), true);
  assert.equal(isValidPayout(0.92), true);
  assert.equal(isValidPayout(1), true);
  assert.equal(isValidPayout(0), false);
  assert.equal(isValidPayout(-0.5), false);
  assert.equal(isValidPayout(1.01), false);
  assert.equal(isValidPayout(500), false);
});

test('index.html defines a same-origin-only CSP with no inline/eval sources and no inline style attributes (finding #12)', async () => {
  const fs = await import('node:fs/promises');
  const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
  const cspMatch = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(cspMatch, 'CSP meta tag must be present in <head>');
  const csp = cspMatch[1];
  for (const directive of ['default-src', 'script-src', 'style-src', 'img-src', 'font-src', 'connect-src', 'manifest-src', 'object-src', 'base-uri', 'form-action', 'frame-ancestors']) {
    assert.ok(csp.includes(directive), `CSP missing directive: ${directive}`);
  }
  assert.ok(!csp.includes('unsafe-inline'), 'CSP must not allow unsafe-inline');
  assert.ok(!csp.includes('unsafe-eval'), 'CSP must not allow unsafe-eval');
  assert.ok(csp.includes("object-src 'none'"), 'object-src should be none (no plugins used)');
  // No inline style="..." attributes anywhere in the document (would be blocked by strict style-src).
  assert.ok(!/\sstyle\s*=\s*"/.test(html), 'index.html must not contain inline style attributes under strict CSP');
  // No inline event handler attributes (onclick=, onchange=, etc).
  assert.ok(!/\son[a-z]+\s*=\s*"/i.test(html), 'index.html must not contain inline event handler attributes');
});

test('CSP audit keeps dynamically generated HTML free of inline style attributes (finding #12)', async () => {
  const fs = await import('node:fs/promises');
  const app = await fs.readFile(new URL('../src/js/app.js', import.meta.url), 'utf8');
  assert.ok(!/<[^>]+\sstyle\s*=\s*["']/i.test(app), 'app.js must not generate inline style attributes under strict CSP');
  assert.ok(!/<[^>]+\son[a-z]+\s*=\s*["']/i.test(app), 'app.js must not generate inline event handler attributes');
});

test('tpEditHint is fully removed after its producer was deleted (finding #15)', async () => {
  const fs = await import('node:fs/promises');
  const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
  const app = await fs.readFile(new URL('../src/js/app.js', import.meta.url), 'utf8');
  assert.ok(!/\bid=["']tpEditHint["']/i.test(html), 'tpEditHint must not remain in index.html');
  assert.ok(!/\btpEditHint\b/.test(app), 'tpEditHint must not remain referenced by app.js');
});
