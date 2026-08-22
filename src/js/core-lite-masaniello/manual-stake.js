/**
 * MANUAL FIRST-TRADE STAKE OVERRIDE (Simple mode only)
 *
 * Lets the user type the amount they actually traded for trade #1
 * instead of the Planner's suggested stake, without touching any of
 * the core stake-calculation engines (simple.js, planner.js,
 * plan-analyzer.js, scenario-simulator.js, masaniello.js).
 *
 * This module is intentionally pure (no DOM, no app state) so it can
 * be unit-tested directly. app.js is the only caller.
 */

/**
 * Parse whatever the user typed into the stake box into a number.
 * Strips currency symbols, commas and whitespace the same way the
 * app's num() helper does elsewhere. Returns NaN for anything that
 * doesn't parse (which validateManualFirstStake() then rejects).
 */
export function parseManualStakeInput(raw) {
  const cleaned = String(raw ?? '').replace(/[$,\s]/g, '');
  if (cleaned === '') return NaN;
  return parseFloat(cleaned);
}

/**
 * Validate a manually-entered trade #1 stake against the same safety
 * constraints the live engine already enforces: finite, positive, no
 * more than the current balance, and must not breach the stop-loss
 * balance. Returns {valid:true} or {valid:false, message} where
 * message is a ready-to-display Persian error string.
 */
export function validateManualFirstStake(amount, currentBalance, stopLossBalance) {
  if (!Number.isFinite(amount)) {
    return { valid: false, message: '⚠ مبلغ معامله اول نامعتبر است.' };
  }
  if (amount <= 0) {
    return { valid: false, message: '⚠ مبلغ معامله اول باید بزرگ‌تر از صفر باشد.' };
  }
  if (amount > currentBalance) {
    return { valid: false, message: '⚠ مبلغ معامله اول نمی‌تواند بیشتر از موجودی باشد.' };
  }
  if (currentBalance - amount < stopLossBalance) {
    return { valid: false, message: '⚠ این مبلغ باعث عبور از حد ضرر (Stop Loss) می‌شود.' };
  }
  return { valid: true };
}
