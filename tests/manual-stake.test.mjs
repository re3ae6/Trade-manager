import test from 'node:test';
import assert from 'node:assert/strict';
import { parseManualStakeInput, validateManualFirstStake } from '../src/js/core/manual-stake.js';

test('parseManualStakeInput: plain numbers', () => {
  assert.equal(parseManualStakeInput('10'), 10);
  assert.equal(parseManualStakeInput('1.18'), 1.18);
});

test('parseManualStakeInput: strips currency symbols/commas/whitespace', () => {
  assert.equal(parseManualStakeInput('$10'), 10);
  assert.equal(parseManualStakeInput('1,000.50'), 1000.5);
  assert.equal(parseManualStakeInput(' 10 '), 10);
});

test('parseManualStakeInput: empty string is NaN', () => {
  assert.ok(Number.isNaN(parseManualStakeInput('')));
});

test('parseManualStakeInput: garbage text is NaN', () => {
  assert.ok(Number.isNaN(parseManualStakeInput('abc')));
});

// ---------------------------------------------------------------------
// validateManualFirstStake — covers every case from the audit's list of
// values that must be rejected, plus the two "manual equals/differs from
// suggestion" happy paths (those are really just "is a valid positive
// number within balance/stop-loss", which is exactly what this validates;
// which literal number was typed doesn't change the validation logic).
// ---------------------------------------------------------------------

test('validateManualFirstStake: manual amount equal to a plausible suggestion is accepted', () => {
  const result = validateManualFirstStake(1.18, 1000, 800);
  assert.equal(result.valid, true);
});

test('validateManualFirstStake: manual amount different from suggestion is accepted', () => {
  const result = validateManualFirstStake(10, 1000, 800);
  assert.equal(result.valid, true);
});

test('validateManualFirstStake: rejects zero', () => {
  const result = validateManualFirstStake(0, 1000, 800);
  assert.equal(result.valid, false);
  assert.match(result.message, /بزرگ‌تر از صفر/);
});

test('validateManualFirstStake: rejects negative amounts', () => {
  const result = validateManualFirstStake(-1, 1000, 800);
  assert.equal(result.valid, false);
  assert.match(result.message, /بزرگ‌تر از صفر/);
});

test('validateManualFirstStake: rejects NaN', () => {
  const result = validateManualFirstStake(NaN, 1000, 800);
  assert.equal(result.valid, false);
  assert.match(result.message, /نامعتبر/);
});

test('validateManualFirstStake: rejects Infinity', () => {
  const result = validateManualFirstStake(Infinity, 1000, 800);
  assert.equal(result.valid, false);
  assert.match(result.message, /نامعتبر/);
});

test('validateManualFirstStake: rejects amount greater than balance', () => {
  const result = validateManualFirstStake(1500, 1000, 800);
  assert.equal(result.valid, false);
  assert.match(result.message, /موجودی/);
});

test('validateManualFirstStake: rejects amount that would breach stop-loss', () => {
  // balance 1000, stop-loss floor 800 -> max allowed stake is 200
  const result = validateManualFirstStake(500, 1000, 800);
  assert.equal(result.valid, false);
  assert.match(result.message, /حد ضرر/);
});

test('validateManualFirstStake: accepts an amount exactly at the stop-loss boundary', () => {
  // balance 1000, stop-loss floor 800 -> stake of exactly 200 lands right on the boundary
  const result = validateManualFirstStake(200, 1000, 800);
  assert.equal(result.valid, true);
});

test('validateManualFirstStake: accepts an amount equal to the entire balance when stop-loss allows it', () => {
  const result = validateManualFirstStake(1000, 1000, 0);
  assert.equal(result.valid, true);
});

test('validateManualFirstStake: low-capital fallback scenario — small balance, small stake, still validated the same way', () => {
  // e.g. $10 capital, fallback plan suggests $1 stake, 20% stop-loss -> floor $8
  const accepted = validateManualFirstStake(1, 10, 8);
  assert.equal(accepted.valid, true);

  const tooMuch = validateManualFirstStake(5, 10, 8); // would drop balance to 5, below the 8 floor
  assert.equal(tooMuch.valid, false);
  assert.match(tooMuch.message, /حد ضرر/);

  const overBalance = validateManualFirstStake(11, 10, 8); // more than the entire $10 balance
  assert.equal(overBalance.valid, false);
  assert.match(overBalance.message, /موجودی/);
});
