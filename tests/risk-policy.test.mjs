import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RISK_POLICIES,
  calculateBoundedStake
} from '../src/js/core/risk-policy.js';

test('risk policies use the specified multipliers, recovery factors and caps', () => {
  assert.deepEqual(RISK_POLICIES, {
    low: {
      riskMultiplier: 1,
      recoveryFactor: 0.30,
      maxStakePct: 0.06
    },
    medium: {
      riskMultiplier: 2,
      recoveryFactor: 0.50,
      maxStakePct: 0.12
    },
    high: {
      riskMultiplier: 3,
      recoveryFactor: 0.70,
      maxStakePct: 0.20
    }
  });
});

test('initial stake is 1x/2x/3x profitPerWin and does not divide by payout', () => {
  const common = {
    profitPerWin: 2,
    payout: 0.8,
    cumulativeLoss: 0,
    capital: 100,
    currentBalance: 100,
    minStake: 1,
    stopLossBalance: 0
  };

  assert.equal(calculateBoundedStake({ ...common, risk: 'low' }).stake, 2);
  assert.equal(calculateBoundedStake({ ...common, risk: 'medium' }).stake, 4);
  assert.equal(calculateBoundedStake({ ...common, risk: 'high' }).stake, 6);
});

test('15 consecutive losses reproduce the deterministic reference balances', () => {
  const expected = {
    low: 43.678109012104336,
    medium: 17.024541862673942,
    high: 4.549229359923201
  };

  for (const risk of ['low', 'medium', 'high']) {
    let balance = 100;
    let cumulativeLoss = 0;

    for (let i = 0; i < 15; i += 1) {
      const result = calculateBoundedStake({
        risk,
        profitPerWin: 2,
        payout: 0.8,
        cumulativeLoss,
        capital: 100,
        currentBalance: balance,
        minStake: 1,
        stopLossBalance: 0
      });

      assert.equal(result.reason, 'ok');
      assert.ok(result.stake > 0);
      assert.ok(result.stake <= balance);

      balance -= result.stake;
      cumulativeLoss += result.stake;
    }

    assert.ok(
      Math.abs(balance - expected[risk]) < 1e-10,
      `${risk}: expected ${expected[risk]}, got ${balance}`
    );
  }
});

test('LOW stop loss rejects loss #4 at threshold 90', () => {
  let balance = 100;
  let cumulativeLoss = 0;

  const stakes = [];

  for (let loss = 1; loss <= 4; loss += 1) {
    const result = calculateBoundedStake({
      risk: 'low',
      profitPerWin: 2,
      payout: 0.8,
      cumulativeLoss,
      capital: 100,
      currentBalance: balance,
      minStake: 1,
      stopLossBalance: 90
    });

    stakes.push(result);

    if (loss < 4) {
      assert.equal(result.reason, 'ok');
      balance -= result.stake;
      cumulativeLoss += result.stake;
    } else {
      assert.equal(result.reason, 'stoploss');
      assert.equal(result.stake, 0);
    }
  }
});

test('MEDIUM stop loss rejects loss #2 at threshold 90', () => {
  let balance = 100;
  let cumulativeLoss = 0;

  const first = calculateBoundedStake({
    risk: 'medium',
    profitPerWin: 2,
    payout: 0.8,
    cumulativeLoss,
    capital: 100,
    currentBalance: balance,
    minStake: 1,
    stopLossBalance: 90
  });

  assert.equal(first.reason, 'ok');
  assert.equal(first.stake, 4);

  balance -= first.stake;
  cumulativeLoss += first.stake;

  const second = calculateBoundedStake({
    risk: 'medium',
    profitPerWin: 2,
    payout: 0.8,
    cumulativeLoss,
    capital: 100,
    currentBalance: balance,
    minStake: 1,
    stopLossBalance: 90
  });

  assert.equal(second.reason, 'stoploss');
  assert.equal(second.stake, 0);
});

test('HIGH stop loss rejects loss #2 at threshold 90', () => {
  let balance = 100;
  let cumulativeLoss = 0;

  const first = calculateBoundedStake({
    risk: 'high',
    profitPerWin: 2,
    payout: 0.8,
    cumulativeLoss,
    capital: 100,
    currentBalance: balance,
    minStake: 1,
    stopLossBalance: 90
  });

  assert.equal(first.reason, 'ok');
  assert.equal(first.stake, 6);

  balance -= first.stake;
  cumulativeLoss += first.stake;

  const second = calculateBoundedStake({
    risk: 'high',
    profitPerWin: 2,
    payout: 0.8,
    cumulativeLoss,
    capital: 100,
    currentBalance: balance,
    minStake: 1,
    stopLossBalance: 90
  });

  assert.equal(second.reason, 'stoploss');
  assert.equal(second.stake, 0);
});

test('hybrid cap never permits stake greater than balance', () => {
  for (const risk of ['low', 'medium', 'high']) {
    const result = calculateBoundedStake({
      risk,
      profitPerWin: 1000,
      payout: 0.8,
      cumulativeLoss: 10000,
      capital: 100,
      currentBalance: 50,
      minStake: 1,
      stopLossBalance: 0
    });

    assert.equal(result.reason, 'ok');
    assert.ok(result.stake <= 50);
  }
});

test('minimum stake exceeding capacity is rejected', () => {
  const result = calculateBoundedStake({
    risk: 'low',
    profitPerWin: 2,
    payout: 0.8,
    cumulativeLoss: 0,
    capital: 10,
    currentBalance: 10,
    minStake: 1,
    stopLossBalance: 0
  });

  assert.equal(result.reason, 'minimum-stake-exceeds-capacity');
  assert.equal(result.stake, 0);
});

test('cumulative loss means cumulative lost stake amount', () => {
  const result = calculateBoundedStake({
    risk: 'low',
    profitPerWin: 2,
    payout: 0.8,
    cumulativeLoss: 2,
    capital: 100,
    currentBalance: 98,
    minStake: 1,
    stopLossBalance: 0
  });

  // initial = 2
  // recovery = 2 × (0.30 / 0.80) = 0.75
  // raw = 2.75
  assert.equal(result.stake, 2.75);
});

test('invalid risk is rejected safely', () => {
  const result = calculateBoundedStake({
    risk: 'unknown',
    profitPerWin: 2,
    payout: 0.8,
    cumulativeLoss: 0,
    capital: 100,
    currentBalance: 100
  });

  assert.equal(result.stake, 0);
  assert.equal(result.reason, 'invalid-risk-policy');
});
