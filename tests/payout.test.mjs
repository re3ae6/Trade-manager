import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PAYOUT_MIN,
  PAYOUT_MAX,
  normalizePayout,
  isValidPayout,
  payoutPercent
} from '../src/js/core/payout.js';

test('Payout accepts fractional values used by the core', () => {
  assert.equal(normalizePayout(0.85), 0.85);
  assert.equal(normalizePayout(0.92), 0.92);
  assert.equal(normalizePayout(1), 1);
  assert.equal(isValidPayout(0.85), true);
  assert.equal(isValidPayout(0.92), true);
  assert.equal(isValidPayout(1), true);
});

test('Payout rejects values outside the fractional contract', () => {
  assert.equal(isValidPayout(0), false);
  assert.equal(isValidPayout(-0.5), false);
  assert.equal(isValidPayout(1.01), false);
  assert.equal(isValidPayout(500), false);
});

test('Payout keeps the configured bounds explicit', () => {
  assert.equal(PAYOUT_MIN, 0.01);
  assert.equal(PAYOUT_MAX, 1);
});

test('Legacy percentage values normalize to fractions', () => {
  assert.equal(normalizePayout(85), 0.85);
  assert.equal(normalizePayout(92), 0.92);
  assert.equal(normalizePayout(100), 1);
  assert.equal(isValidPayout(85), true);
  assert.equal(isValidPayout(92), true);
  assert.equal(isValidPayout(100), true);
});

test('Ambiguous values such as 1.01 are not reinterpreted as percentages', () => {
  assert.equal(normalizePayout(1.01), 1.01);
  assert.equal(isValidPayout(1.01), false);
});

test('Invalid and non-finite values normalize safely', () => {
  assert.equal(normalizePayout(0), 0);
  assert.equal(normalizePayout(-1), 0);
  assert.equal(normalizePayout('abc'), 0);
  assert.equal(normalizePayout(Infinity), 0);
  assert.equal(normalizePayout(NaN), 0);
});

test('Payout percentage representation is consistent', () => {
  assert.equal(payoutPercent(0.85), 85);
  assert.equal(payoutPercent(0.92), 92);
  assert.equal(payoutPercent(1), 100);
  assert.equal(payoutPercent(85), 85);
});
