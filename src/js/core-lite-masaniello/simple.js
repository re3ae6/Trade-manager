import { calculateBoundedStake } from './risk-policy.js';
import { calculateBoundedRecoveryStake } from './recovery.js';

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
    allowLowCapitalMinStake = false,
    selectedPlan = null,
    tradeIndex = 0
  } = options || {};

  /*
   * Source-of-Truth override for a confirmed low-capital fallback plan.
   *
   * The Planner already computed and safety-checked the executable stake.
   * For this narrow small-account case, honor the confirmed stake directly
   * instead of applying the normal percentage-cap risk policy.
   */
  if (selectedPlan?.lowCapitalFallback === true) {
    const planStake = selectedPlan.stakesPreview?.[tradeIndex];

    if (
      Number.isFinite(planStake) &&
      planStake > 0 &&
      Number.isFinite(capital) &&
      capital > 0 &&
      capital <= 15 &&
      Number.isFinite(currentBalance) &&
      planStake <= currentBalance &&
      currentBalance - planStake >= stopLossBalance
    ) {
      return {
        stake: planStake,
        reason: 'ok',
        rawStake: planStake,
        effectiveCap: planStake,
        projectedBalance: currentBalance - planStake,
        lowCapitalFallback: true
      };
    }

    /*
     * Low-capital fallback continuation.
     *
     * The planner intentionally guarantees only the first fallback
     * trade. After that trade, do not switch to the normal target
     * formula: it can demand a stake larger than the remaining
     * stop-loss-safe capacity and incorrectly lock the session.
     *
     * Instead, size the next trade with the bounded recovery engine:
     * it stakes the largest amount that still fits within the
     * stop-loss-safe capacity (up to what's actually required to
     * recover the accumulated loss plus target), and only refuses to
     * trade once even the configured minimum stake no longer fits.
     * This does not extend the original target guarantee and is not
     * unbounded recovery/Martingale sizing.
     */
    if (
      tradeIndex >= (selectedPlan.stakesPreview?.length ?? 0) &&
      allowLowCapitalMinStake === true &&
      Number.isFinite(floor) &&
      floor > 0 &&
      Number.isFinite(currentBalance)
    ) {
      const bounded = calculateBoundedRecoveryStake({
        currentBalance,
        payout,
        accumulatedLoss: cumulativeLoss,
        targetProfit,
        stopLossBalance,
        minStake: floor
      });

      if (bounded.canRecover && bounded.stake > 0) {
        return {
          stake: bounded.stake,
          reason: 'ok',
          rawStake: bounded.stake,
          effectiveCap: bounded.stake,
          projectedBalance: currentBalance - bounded.stake,
          fullRecovery: bounded.fullRecovery,
          lowCapitalFallback: true,
          lowCapitalContinuation: true
        };
      }

      return {
        stake: 0,
        reason: bounded.reason || 'stoploss',
        lowCapitalFallback: true,
        lowCapitalContinuation: true
      };
    }
  }

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
