import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMasaTableFor,
  masaTargetMultiplier,
  masanielloStake,
  guaranteedWorstCaseFinal,
  simulateAllWinFinal,
  findHighRiskN,
  findMinK,
  computePlan,
  buildPlan
} from '../src/js/core/masaniello-plan-engine.js';

test('plan engine exports the complete planning API', () => {
  assert.equal(typeof buildMasaTableFor, 'function');
  assert.equal(typeof masaTargetMultiplier, 'function');
  assert.equal(typeof masanielloStake, 'function');
  assert.equal(typeof guaranteedWorstCaseFinal, 'function');
  assert.equal(typeof simulateAllWinFinal, 'function');
  assert.equal(typeof findHighRiskN, 'function');
  assert.equal(typeof findMinK, 'function');
  assert.equal(typeof computePlan, 'function');
});

test('plan engine produces deterministic plans', () => {
  const a = computePlan('medium', 1000, 85, 50, 1);
  const b = computePlan('medium', 1000, 85, 50, 1);

  assert.deepEqual(a, b);
});

test('plan engine preserves target guarantee', () => {
  const plan = computePlan('medium', 1000, 85, 50, 1);

  assert.ok(plan);
  const worst = guaranteedWorstCaseFinal(
    1000,
    plan.n,
    plan.k,
    1.85
  );

  assert.ok(worst >= 1050 - 1e-9);
});

test('plan engine handles forced-win state', () => {
  assert.deepEqual(
    masanielloStake(100, 2, 2, 1.85, 1, 5, 5),
    { stake: 100, reason: 'ok' }
  );
});

test('plan engine rejects impossible state', () => {
  assert.deepEqual(
    masanielloStake(100, 2, 3, 1.85, 1, 5, 5),
    { stake: 0, reason: 'target-impossible' }
  );
});

test('plan engine remains bounded by its search limit', () => {
  assert.equal(
    computePlan('high', 1, 0.01, 1e9, 1),
    null
  );
});

test('buildPlan exposes a complete immutable plan description', () => {
  const plan = buildPlan({
    risk: 'medium',
    capital: 1000,
    payoutPct: 85,
    targetProfit: 50,
    floor: 1
  });

  assert.ok(plan);
  assert.equal(plan.risk, 'medium');
  assert.equal(plan.capital, 1000);
  assert.equal(plan.payoutPct, 85);
  assert.equal(plan.targetProfit, 50);
  assert.equal(plan.targetBalance, 1050);
  assert.equal(plan.losses, plan.n - plan.k);
  assert.ok(plan.worstCaseFinal >= plan.targetBalance - 1e-9);
});

test('buildPlan rejects invalid planning input', () => {
  assert.equal(
    buildPlan({
      risk: 'unknown',
      capital: 1000,
      payoutPct: 85,
      targetProfit: 50,
      floor: 1
    }),
    null
  );

  assert.equal(
    buildPlan({
      risk: 'medium',
      capital: 0,
      payoutPct: 85,
      targetProfit: 50,
      floor: 1
    }),
    null
  );
});

test('buildPlan preserves the exact engine plan', () => {
  for (const risk of ['low', 'medium', 'high']) {
    const result = buildPlan({
      risk,
      capital: 1000,
      payoutPct: 85,
      targetProfit: 50,
      floor: 1
    });

    const raw = computePlan(risk, 1000, 85, 50, 1);

    assert.ok(result);
    assert.deepEqual(
      { n: result.n, k: result.k },
      raw
    );

    assert.equal(result.losses, result.n - result.k);
    assert.equal(result.targetBalance, 1050);

    assert.ok(
      result.worstCaseFinal >= result.targetBalance - 1e-9
    );
  }
});

test('buildPlan does not mutate its input', () => {
  const input = {
    risk: 'medium',
    capital: 1000,
    payoutPct: 85,
    targetProfit: 50,
    floor: 1
  };

  const before = structuredClone(input);
  const result = buildPlan(input);

  assert.ok(result);
  assert.deepEqual(input, before);
});

test('buildPlan rejects non-finite numeric input', () => {
  for (const key of [
    'capital',
    'payoutPct',
    'targetProfit',
    'floor'
  ]) {
    const input = {
      risk: 'medium',
      capital: 1000,
      payoutPct: 85,
      targetProfit: 50,
      floor: 1
    };

    input[key] = Infinity;

    assert.equal(buildPlan(input), null);
  }
});
