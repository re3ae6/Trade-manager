/**
 * Bounded Simple risk policy.
 *
 * This module is pure stake-sizing logic.
 * It does not access DOM, storage, session state, or UI.
 *
 * Policy:
 * LOW    = 1x initial / 0.30 recovery / 6% cap
 * MEDIUM = 2x initial / 0.50 recovery / 12% cap
 * HIGH   = 3x initial / 0.70 recovery / 20% cap
 *
 * payout is used ONLY by the recovery component.
 */

export const RISK_POLICIES = Object.freeze({
  low: Object.freeze({
    riskMultiplier: 1.0,
    recoveryFactor: 0.30,
    maxStakePct: 0.06
  }),

  medium: Object.freeze({
    riskMultiplier: 2.0,
    recoveryFactor: 0.50,
    maxStakePct: 0.12
  }),

  high: Object.freeze({
    riskMultiplier: 3.0,
    recoveryFactor: 0.70,
    maxStakePct: 0.20
  })
});

export function calculateBoundedStake({
  risk,
  profitPerWin,
  payout,
  cumulativeLoss,
  capital,
  currentBalance,
  minStake = 1,
  stopLossBalance = 0,
  allowLowCapitalMinStake = false
}) {
  const policy = RISK_POLICIES[risk];

  if (!policy) {
    return {
      stake: 0,
      reason: 'invalid-risk-policy'
    };
  }

  if (
    !Number.isFinite(profitPerWin) ||
    !Number.isFinite(payout) ||
    !Number.isFinite(cumulativeLoss) ||
    !Number.isFinite(capital) ||
    !Number.isFinite(currentBalance) ||
    !Number.isFinite(minStake) ||
    !Number.isFinite(stopLossBalance) ||
    payout <= 0 ||
    capital < 0 ||
    currentBalance < 0
  ) {
    return {
      stake: 0,
      reason: 'invalid-input'
    };
  }

  /*
   * Initial stake deliberately does NOT divide by payout.
   */
  const initialStake =
    profitPerWin * policy.riskMultiplier;

  /*
   * payout affects recovery only.
   * cumulativeLoss means cumulative stake amounts lost.
   */
  const recoveryStake =
    cumulativeLoss * (policy.recoveryFactor / payout);

  const rawStake =
    initialStake + recoveryStake;

  /*
   * Hybrid cap:
   * min(capital × pct, balance × pct)
   *
   * On a pure losing path balance <= capital,
   * therefore this naturally becomes balance × pct.
   */
  const effectiveCap = Math.min(
    capital * policy.maxStakePct,
    currentBalance * policy.maxStakePct
  );

  /*
   * A minimum stake larger than available capacity
   * must be rejected, never forced through the cap.
   */
  let stakeCap = effectiveCap;

  /*
   * Normal behavior remains unchanged.
   * Only an explicit low-capital caller may bypass the
   * percentage cap for the configured minimum stake.
   */
  if (minStake > stakeCap) {
    const lowCapitalAllowed =
      allowLowCapitalMinStake === true &&
      capital > 0 &&
      capital <= 15 &&
      minStake <= currentBalance &&
      currentBalance - minStake >= stopLossBalance;

    if (!lowCapitalAllowed) {
      return {
        stake: 0,
        reason: 'minimum-stake-exceeds-capacity',
        rawStake,
        effectiveCap: stakeCap
      };
    }

    stakeCap = minStake;
  }

  let stake = Math.min(rawStake, stakeCap);

  if (stake < minStake) {
    stake = minStake;
  }

  /*
   * Structural balance safety.
   * maxStakePct < 1 already guarantees this under valid inputs,
   * but keep the invariant explicit.
   */
  stake = Math.min(stake, currentBalance);

  const projectedBalance =
    currentBalance - stake;

  if (
    stake <= 0 ||
    projectedBalance < stopLossBalance
  ) {
    return {
      stake: 0,
      reason: 'stoploss',
      rawStake,
      effectiveCap,
      attemptedStake: stake,
      projectedBalance
    };
  }

  return {
    stake,
    reason: 'ok',
    rawStake,
    effectiveCap,
    projectedBalance
  };
}
