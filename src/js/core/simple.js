import { calculateBoundedStake } from './risk-policy.js';

/**
 * Calculate the next Simple-mode stake.
 *
 * Legacy behavior is preserved when no risk policy is supplied.
 * When `risk` is supplied, the bounded risk-policy engine becomes
 * authoritative.
 */
export function calculateSimpleNextStake(
  payout,
  targetProfit,
  streakLoss,
  floor = 1,
  balance = Infinity,
  stopLossBalance = 0,
  options = {}
) {
  // Support both the original positional API and the current object API.
  // This keeps all existing callers backward-compatible.
  if (payout && typeof payout === 'object') {
    const params = payout;
    payout = params.payout;
    targetProfit = params.targetProfit;
    streakLoss = params.streakLoss ?? 0;
    floor = params.floor ?? 1;
    balance = params.balance ?? Infinity;
    stopLossBalance = params.stopLossBalance ?? 0;
    options = params;
  }

  const {
    risk,
    capital = balance,
    currentBalance = balance,
    cumulativeLoss = streakLoss,
    allowLowCapitalMinStake = false
  } = options || {};

  if (risk) {
    return calculateBoundedStake({
      risk,
      profitPerWin: targetProfit,
      payout,
      cumulativeLoss,
      capital,
      currentBalance,
      minStake: floor,
      stopLossBalance,
      allowLowCapitalMinStake
    });
  }

  // Legacy Simple behavior.
  if (!Number.isFinite(payout) || payout <= 0) {
    return { stake: 0, reason: 'invalid-payout' };
  }

  if (!Number.isFinite(targetProfit) || !Number.isFinite(streakLoss)) {
    return { stake: 0, reason: 'invalid-input' };
  }

  if (balance < floor) {
    return { stake: 0, reason: 'insufficient-balance' };
  }

  const requiredReturn = streakLoss + targetProfit;
  let stake = requiredReturn / payout;

  if (stake < floor) {
    stake = floor;
  }

  const projectedBalance = balance - stake;

  if (
    !Number.isFinite(stake) ||
    stake <= 0 ||
    projectedBalance < stopLossBalance
  ) {
    return { stake: 0, reason: 'stoploss' };
  }

  return {
    stake,
    reason: 'ok'
  };
}
