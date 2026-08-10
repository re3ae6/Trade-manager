export function generatePlanId(){
  if(typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'plan_' + Date.now() + '_' + Math.random().toString(36).slice(2);
}

export function resolvePlanTarget(planStartBalance, targetPercent, targetBalance){
  const hasPercent = Number.isFinite(targetPercent);
  const hasBalance = Number.isFinite(targetBalance);
  let resolvedPercent = hasPercent ? targetPercent : null;
  let resolvedBalance = hasBalance ? targetBalance : null;
  if(hasPercent && !hasBalance){
    resolvedBalance = planStartBalance * (1 + targetPercent / 100);
  } else if(hasBalance && !hasPercent){
    resolvedPercent = planStartBalance > 0 ? (targetBalance / planStartBalance - 1) * 100 : 0;
  }
  return { targetPercent: resolvedPercent, targetBalance: resolvedBalance };
}

export function computeTradingPlanStats(tradingPlan, sessionHistory, currentBalance){
  if(!tradingPlan){
    return {remainingProfit:null,progressPercent:null,sessionsCompletedTowardPlan:0,averageProfitPerCompletedSession:null,estimatedSessionsRemaining:null,requiredAverageProfitPerSession:null,targetReached:false};
  }
  const planSessions = sessionHistory.filter(s => s.endedAt && s.endedAt >= tradingPlan.planCreatedAt);
  const remainingProfit = tradingPlan.targetBalance - currentBalance;
  const denom = tradingPlan.targetBalance - tradingPlan.planStartBalance;
  const progressPercent = denom !== 0 ? ((currentBalance - tradingPlan.planStartBalance) / denom) * 100 : (currentBalance >= tradingPlan.targetBalance ? 100 : 0);
  const sessionsCompletedTowardPlan = planSessions.length;
  const averageProfitPerCompletedSession = sessionsCompletedTowardPlan > 0 ? planSessions.reduce((sum,s)=>sum+s.profit,0)/sessionsCompletedTowardPlan : null;
  const estimatedSessionsRemaining = (averageProfitPerCompletedSession !== null && averageProfitPerCompletedSession > 0) ? remainingProfit / averageProfitPerCompletedSession : null;
  const requiredAverageProfitPerSession = (estimatedSessionsRemaining !== null && estimatedSessionsRemaining !== 0) ? remainingProfit / estimatedSessionsRemaining : null;
  return {remainingProfit,progressPercent,sessionsCompletedTowardPlan,averageProfitPerCompletedSession,estimatedSessionsRemaining,requiredAverageProfitPerSession,targetReached:progressPercent>=100};
}
