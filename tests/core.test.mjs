import test from 'node:test';
import assert from 'node:assert/strict';
import { computePlan, guaranteedWorstCaseFinal, masanielloStake } from '../src/js/core/masaniello.js';
import { calculateSimpleNextStake } from '../src/js/core/simple.js';
import { computeHistoryWithCumulativeStats, buildHistoryCSV } from '../src/js/core/history.js';
import { resolvePlanTarget, computeTradingPlanStats, computeTradingPlanRiskOptions } from '../src/js/core/trading-plan.js';
import { computePerformanceStats } from '../src/js/core/analytics.js';

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
