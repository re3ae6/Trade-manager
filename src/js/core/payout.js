/**
 * Single source of truth for the application's user-facing payout contract.
 *
 * UI/storage may contain legacy percentage values (e.g. 85), but every core
 * calculation receives a normalized fraction (e.g. 0.85).
 */
export const PAYOUT_MIN = 0.01;
export const PAYOUT_MAX = 1;

export function normalizePayout(value){
  const n = Number(value);
  if(!Number.isFinite(n) || n <= 0) return 0;
  // Backward compatibility is deliberately limited to clear whole/ordinary
  // percentage values (2..100). Values such as 1.01 must stay invalid rather
  // than being reinterpreted as 1.01%.
  return n > 1 ? (n >= 2 && n <= 100 ? n / 100 : n) : n;
}

export function isValidPayout(value){
  const p = normalizePayout(value);
  return Number.isFinite(p) && p >= PAYOUT_MIN && p <= PAYOUT_MAX;
}

export function payoutPercent(value){
  return normalizePayout(value) * 100;
}
