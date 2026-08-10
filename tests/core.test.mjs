import test from 'node:test';
import assert from 'node:assert/strict';
import { computePlan, guaranteedWorstCaseFinal, masanielloStake } from '../src/js/core/masaniello.js';
import { calculateSimpleNextStake } from '../src/js/core/simple.js';
import { computeHistoryWithCumulativeStats, buildHistoryCSV } from '../src/js/core/history.js';
import { resolvePlanTarget, computeTradingPlanStats } from '../src/js/core/trading-plan.js';

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
