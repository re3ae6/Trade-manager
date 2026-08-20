/**
 * Bounded recovery engine. This is deliberately NOT Martingale.
 * It sizes only what is required to recover the current loss plus an
 * optional target profit, subject to explicit capital limits.
 */
function finite(v){ return Number.isFinite(Number(v)); }
function round(v){ return Math.round(Number(v)*100)/100; }

export function calculateRecoveryStake({
  balance,
  payout,
  accumulatedLoss=0,
  targetProfit=0,
  stopLossBalance=0,
  maxStake=Infinity,
  maxDrawdown=Infinity,
  drawdownUsed=0,
  attemptsUsed=0,
  maxAttempts=3,
  minStake=1
}){
  const B=Number(balance), P=Number(payout), L=Math.max(0,Number(accumulatedLoss)||0), T=Math.max(0,Number(targetProfit)||0);
  if(!finite(B)||B<=0||!finite(P)||P<=0) return {valid:false,canRecover:false,reason:'invalid-input'};
  if(attemptsUsed>=maxAttempts) return {valid:true,canRecover:false,reason:'max-attempts'};
  const required=(L+T)/P;
  const capitalRoom=Math.max(0,B-Math.max(0,Number(stopLossBalance)||0));
  const ddRoom=Number.isFinite(Number(maxDrawdown)) ? Math.max(0,Number(maxDrawdown)-Math.max(0,Number(drawdownUsed)||0)) : Infinity;
  const configuredMinStake = Math.max(0, Number(minStake) || 0);
  const cap=Math.min(capitalRoom,ddRoom,Number.isFinite(Number(maxStake))?Number(maxStake):Infinity);

  if(!finite(required)||required<=0){
    if(configuredMinStake > cap + 1e-9){
      return {
        valid:true,
        canRecover:false,
        reason:'minimum-stake-exceeds-capacity',
        required:round(configuredMinStake),
        capacity:round(cap)
      };
    }
    return {
      valid:true,
      canRecover:true,
      stake:configuredMinStake,
      required:configuredMinStake,
      capacity:round(cap),
      reason:'ok'
    };
  }

  const stake = Math.max(configuredMinStake, required);
  if(required>cap+1e-9 || stake>cap+1e-9){
    return {
      valid:true,
      canRecover:false,
      reason:'limit-exceeded',
      required:round(required),
      requestedStake:round(stake),
      capacity:round(cap)
    };
  }

  return {
    valid:true,
    canRecover:true,
    stake:round(stake),
    required:round(required),
    capacity:round(cap),
    reason:'ok'
  };
}

/**
 * Bounded recovery stake for the Simple low-capital fallback continuation.
 *
 * Unlike calculateRecoveryStake(), this never "locks" merely because the
 * full recovery+target amount can't fit in the remaining stop-loss-safe
 * capacity. Instead it stakes the largest amount that is still safe
 * (capacity) and reports fullRecovery=false. It only refuses to trade
 * (reason:'stoploss') when even the configured minimum stake no longer
 * fits within capacity.
 */
export function calculateBoundedRecoveryStake({
  currentBalance,
  payout,
  accumulatedLoss = 0,
  targetProfit = 0,
  stopLossBalance = 0,
  minStake = 1
}){
  const B = Number(currentBalance);
  const P = Number(payout);
  const L = Math.max(0, Number(accumulatedLoss) || 0);
  const T = Math.max(0, Number(targetProfit) || 0);
  const SL = Math.max(0, Number(stopLossBalance) || 0);
  const min = Math.max(0, Number(minStake) || 0);

  if(!finite(B) || !finite(P) || P<=0){
    return {valid:false,canRecover:false,stake:0,reason:'invalid-input'};
  }

  const capacity = B - SL;

  if(capacity < min - 1e-9){
    return {
      valid:true,
      canRecover:false,
      stake:0,
      capacity:round(capacity),
      fullRecovery:false,
      reason:'stoploss'
    };
  }

  const required = (L + T) / P;
  const desired = Math.max(min, required);
  const stake = Math.min(desired, capacity);
  const fullRecovery = desired <= capacity + 1e-9;

  return {
    valid:true,
    canRecover:true,
    stake:round(stake),
    required:round(required),
    capacity:round(capacity),
    fullRecovery,
    reason:'ok'
  };
}

export function simulateRecoverySequence({
  capital,
  payout,
  targetProfit,
  stopLossBalance,
  maxStake,
  maxDrawdown,
  maxAttempts=3,
  results=[] ,
  minStake=1
}){
  let balance=Number(capital), loss=0, drawdown=0, peak=balance, attempts=0;
  const rows=[]; const normalized=Array.isArray(results)?results.map(x=>String(x).toUpperCase()):[];
  for(let i=0;i<normalized.length;i++){
    const result=normalized[i];
    if(!['W','BE','L'].includes(result)) return {valid:false,reason:'invalid-result',rows};
    const stake=calculateRecoveryStake({balance,payout,accumulatedLoss:loss,targetProfit,stopLossBalance,maxStake,maxDrawdown,drawdownUsed:drawdown,attemptsUsed:attempts,maxAttempts,minStake});
    if(!stake.canRecover){ return {valid:true,rows,locked:true,lockReason:stake.reason,balance:round(balance),profit:round(balance-Number(capital)),maxDrawdown:round(drawdown),maxStake:rows.reduce((m,r)=>Math.max(m,r.stake),0)}; }
    const s=stake.stake;
    let profit=0;
    if(result==='W'){ profit=s*Number(payout); balance+=profit; loss=0; attempts=0; }
    else if(result==='L'){ profit=-s; balance-=s; loss+=s; attempts+=1; }
    else { attempts=0; }
    peak=Math.max(peak,balance); drawdown=Math.max(drawdown,peak-balance);
    rows.push({no:i+1,result,stake:round(s),profit:round(profit),balance:round(balance)});
    if(balance<=Number(stopLossBalance)+1e-9) return {valid:true,rows,locked:true,lockReason:'stoploss',balance:round(balance),profit:round(balance-Number(capital)),maxDrawdown:round(drawdown),maxStake:rows.reduce((m,r)=>Math.max(m,r.stake),0)};
    if(drawdown>Number(maxDrawdown)+1e-9) return {valid:true,rows,locked:true,lockReason:'max-drawdown',balance:round(balance),profit:round(balance-Number(capital)),maxDrawdown:round(drawdown),maxStake:rows.reduce((m,r)=>Math.max(m,r.stake),0)};
  }
  return {valid:true,rows,locked:false,balance:round(balance),profit:round(balance-Number(capital)),maxDrawdown:round(drawdown),maxStake:rows.reduce((m,r)=>Math.max(m,r.stake),0)};
}
