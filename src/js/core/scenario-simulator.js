import { calculateSimpleNextStake } from './simple.js';
import { masanielloStake } from './masaniello.js';

function finite(value){ return Number.isFinite(Number(value)); }
function round(value){ return Math.round(Number(value) * 100) / 100; }

export function parseScenario(value){
  if(Array.isArray(value)) return value.map(String).map(v => v.trim().toUpperCase()).filter(Boolean);
  return String(value ?? '')
    .split(/[\s,>→|/]+/)
    .map(v => v.trim().toUpperCase())
    .filter(Boolean);
}

export function simulateScenario({
  mode,
  capital,
  payout,
  targetProfit,
  stopLossBalance,
  plan,
  results,
  minStake = 1
}){
  const normalized = parseScenario(results);
  if(!['simple','masaniello'].includes(mode) || !finite(capital) || Number(capital) <= 0 ||
     !finite(payout) || Number(payout) <= 0 || !plan || plan.valid === false){
    return { valid:false, reason:'invalid-input', rows:[] };
  }
  if(normalized.some(result => !['W','BE','L'].includes(result))){
    return { valid:false, reason:'invalid-result', rows:[] };
  }

  let balance = Number(capital);
  let streakLoss = 0;
  let nRemaining = Number(plan.n);
  let kRemaining = Number(plan.k);
  const rows = [];
  let peak = balance;
  let maxDrawdown = 0;
  let maxLossStreak = 0;
  let lossStreak = 0;
  let locked = false;
  let lockReason = null;

  for(let index=0; index<normalized.length; index++){
    const result = normalized[index];

    let stakeResult;
    if(mode === 'simple'){
      stakeResult = calculateSimpleNextStake({
        payout: Number(payout),
        targetProfit: Number(plan.profitPerWin),
        streakLoss,
        floor: minStake,
        balance,
        stopLossBalance
      });
    }else{
      stakeResult = masanielloStake(
        balance, nRemaining, kRemaining,
        1 + Number(payout), minStake, Number(plan.n), Number(plan.k)
      );
    }

    if(stakeResult.reason !== 'ok'){
      locked = true;
      lockReason = stakeResult.reason;
      rows.push({
        no:index + 1,
        result,
        stake:0,
        balance:round(balance),
        profit:0,
        reason:stakeResult.reason,
        executed:false
      });
      break;
    }

    const stake = Number(stakeResult.stake);
    let profit = 0;
    if(result === 'W'){
      profit = stake * Number(payout);
      balance += profit;
      if(mode === 'simple') streakLoss = 0;
      else {
        kRemaining -= 1;
        nRemaining -= 1;
      }
      lossStreak = 0;
    }else if(result === 'L'){
      profit = -stake;
      balance -= stake;
      if(mode === 'simple') streakLoss += stake;
      else nRemaining -= 1;
      lossStreak += 1;
      maxLossStreak = Math.max(maxLossStreak, lossStreak);
    }else{
      // BE is neutral: it is counted as a trade but does not consume a Masaniello opportunity.
      lossStreak = 0;
    }

    if(mode === 'simple' && result === 'BE'){
      // BE is a real trade but does not alter the loss recovery streak.
      streakLoss = streakLoss;
    }

    peak = Math.max(peak, balance);
    maxDrawdown = Math.max(maxDrawdown, peak - balance);

    let reason = 'ok';
    if(mode === 'simple' && finite(stopLossBalance) && balance <= Number(stopLossBalance)){
      locked = true; lockReason = 'stoploss'; reason = 'stoploss';
    }else if(mode === 'masaniello' && kRemaining <= 0){
      locked = true; lockReason = 'target'; reason = 'target';
    }else if(mode === 'masaniello' && nRemaining <= 0){
      locked = true; lockReason = 'plan-complete'; reason = 'plan-complete';
    }else if(mode === 'simple' && Number.isFinite(Number(plan.k)) &&
             rows.filter(r => r.result === 'W' && r.executed).length + (result === 'W' ? 1 : 0) >= Number(plan.k)){
      locked = true; lockReason = 'target'; reason = 'target';
    }

    rows.push({
      no:index + 1,
      result,
      stake:round(stake),
      balance:round(balance),
      profit:round(profit),
      reason,
      executed:true
    });

    if(locked) break;
  }

  const wins = rows.filter(r => r.executed && r.result === 'W').length;
  const losses = rows.filter(r => r.executed && r.result === 'L').length;
  const breakevens = rows.filter(r => r.executed && r.result === 'BE').length;
  const trades = wins + losses + breakevens;
  const initial = Number(capital);
  const finalBalance = balance;
  const targetBalance = initial + Number(targetProfit);
  const targetHit = finite(targetProfit) && finalBalance >= targetBalance - 1e-9;
  const stopLossHit = lockReason === 'stoploss';

  return {
    valid:true,
    mode,
    rows,
    locked,
    lockReason,
    trades,
    wins,
    losses,
    breakevens,
    winRate: trades ? wins / trades * 100 : 0,
    profit: finalBalance - initial,
    finalBalance:round(finalBalance),
    maxDrawdown:round(maxDrawdown),
    maxLossStreak,
    targetHit,
    stopLossHit,
    nRemaining: mode === 'masaniello' ? nRemaining : null,
    kRemaining: mode === 'masaniello' ? kRemaining : null
  };
}
