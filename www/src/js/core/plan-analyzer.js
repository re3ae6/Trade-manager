import { calculateSimpleNextStake } from './simple.js';
import { masanielloStake, guaranteedWorstCaseFinal } from './masaniello.js';

function finite(value){ return Number.isFinite(Number(value)); }
function safe(value, fallback=0){ return finite(value) ? Number(value) : fallback; }
function round(value){ return Math.round(value * 100) / 100; }

/**
 * Read-only risk analysis over an already-selected Planner option.
 * It deliberately calls the existing Simple/Masaniello sizing engines and
 * never changes their state or formulas.
 */
export function analyzePlan({ mode, capital, payoutPct, targetBalance, stopLossBalance, plan, minStake=1 }){
  if(!plan || plan.valid === false || !finite(capital) || capital <= 0 || !finite(payoutPct) || payoutPct <= 0 || !finite(targetBalance)){
    return { valid:false, reason:'invalid-input' };
  }

  const payout = Number(payoutPct) / 100;
  const targetProfit = Number(targetBalance) - Number(capital);
  const allowedLosses = Math.max(0, (Number(plan.n) || 0) - (Number(plan.k) || 0));
  const losses = [];
  let balance = Number(capital);
  let streakLoss = 0;
  let nRemaining = Number(plan.n) || 0;
  let kRemaining = Number(plan.k) || 0;
  let maxStake = 0;
  let minBalance = balance;
  let stopLossHit = false;
  const stakePreview = [];

  const takeStake = () => {
    if(mode === 'simple'){
      const result = calculateSimpleNextStake({
        payout,
        targetProfit: targetProfit / Math.max(1, Number(plan.k) || 1),
        streakLoss,
        floor: minStake,
        balance,
        stopLossBalance
      });
      if(result.reason !== 'ok') return result;
      return result;
    }
    return masanielloStake(balance, nRemaining, kRemaining, 1 + payout, minStake, Number(plan.n), Number(plan.k));
  };

  // Stress path: consecutive losses only. This is an analyzer preview, not
  // a replacement for either engine.
  for(let i=0; i<allowedLosses; i++){
    const result = takeStake();
    if(result.reason !== 'ok'){
      stopLossHit = result.reason === 'stoploss';
      losses.push({ index:i+1, stake:0, balance:round(balance), reason:result.reason });
      break;
    }
    const stake = Number(result.stake);
    stakePreview.push(stake);
    maxStake = Math.max(maxStake, stake);
    balance -= stake;
    if(mode === 'simple') streakLoss += stake;
    else nRemaining -= 1;
    minBalance = Math.min(minBalance, balance);
    if(finite(stopLossBalance) && balance < Number(stopLossBalance) - 1e-9){
      stopLossHit = true;
    }
    losses.push({ index:i+1, stake:round(stake), balance:round(balance), reason:'loss' });
    if(balance <= 0) break;
  }

  let worstCaseFinal = null;
  if(mode === 'masaniello'){
    worstCaseFinal = guaranteedWorstCaseFinal(Number(capital), Number(plan.n), Number(plan.k), 1 + payout);
  }else if(Array.isArray(plan.stakesPreview) && plan.stakesPreview.length){
    // buildSimplePlan already uses the transparent losses-first stress path.
    worstCaseFinal = Number(plan.expectedFinal);
    maxStake = Math.max(maxStake, Number(plan.maxStake) || 0);
  }

  const maxDrawdown = Math.max(0, Number(capital) - minBalance);
  const targetReachable = finite(worstCaseFinal) && worstCaseFinal >= Number(targetBalance) - 0.005;
  const stopLossSafe = !finite(stopLossBalance) || (!stopLossHit && minBalance >= Number(stopLossBalance) - 0.005);
  const status = targetReachable && stopLossSafe ? 'safe' : 'warning';

  return {
    valid:true,
    mode,
    capital:Number(capital),
    targetBalance:Number(targetBalance),
    targetProfit,
    stopLossBalance:finite(stopLossBalance) ? Number(stopLossBalance) : null,
    initialStake:stakePreview.length ? stakePreview[0] : (finite(plan.stakesPreview?.[0]) ? Number(plan.stakesPreview[0]) : null),
    maxStake:Math.max(maxStake, Number(plan.maxStake) || 0),
    maxLossStreak:allowedLosses,
    maxDrawdown,
    worstCaseFinal,
    targetReachable,
    stopLossSafe,
    stopLossHit,
    status,
    losses
  };
}
