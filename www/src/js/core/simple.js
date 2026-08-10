export function calculateSimpleNextStake({payout, targetProfit, streakLoss, floor, balance, stopLossBalance}){
  const requiredReturn = streakLoss + targetProfit;
  let stake = requiredReturn / payout;
  if(stake < floor) stake = floor;
  if(balance < floor) return {stake:0, reason:'insufficient-balance'};
  const projected = balance - stake;
  if(stake <= 0 || projected < stopLossBalance) return {stake:0, reason:'stoploss'};
  return {stake, reason:'ok'};
}
