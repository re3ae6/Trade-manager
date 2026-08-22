/**
 * Deterministic, read-only structural risk scoring over an already-built plan.
 *
 * IMPORTANT:
 * - This is decision support, NOT a probability of loss.
 * - It never changes an existing strategy engine or session state.
 * - Classification limits are an explicit product policy, not market statistics.
 * - The policy is returned with every result so the UI/audit can explain why
 *   a level was assigned.
 */

const DEFAULT_POLICY = Object.freeze({
  scoreMax: 100,
  initialStakePctLimit: 10,
  maxStakePctLimit: 25,
  drawdownPctLimit: 20,
  exposurePctLimit: 50,
  targetToStopRatioLimit: 1,
  lossStreakReference: 5,
  bands: Object.freeze({
    safeMax: 24.99,
    moderateMax: 49.99,
    highMax: 74.99
  })
});

function finite(v){ return Number.isFinite(Number(v)); }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function round(v){ return Math.round(Number(v)*100)/100; }

function normalizePolicy(policy={}){
  const p={...DEFAULT_POLICY,...policy, bands:{...DEFAULT_POLICY.bands,...(policy.bands||{})}};
  return p;
}

function ratioScore(value, limit, weight){
  if(!finite(value) || !finite(limit) || Number(limit)<=0) return 0;
  return clamp(Math.max(0,Number(value))/Number(limit)*Number(weight),0,Number(weight));
}

export function scoreRisk(input={}){
  const {
    capital,
    targetBalance,
    stopLossBalance,
    initialStake,
    maxStake,
    maxDrawdown,
    maxLossStreak=0,
    recoveryExposure=0,
    policy={}
  }=input;

  const p=normalizePolicy(policy);
  const C=Number(capital);
  if(!finite(C)||C<=0) return {valid:false,reason:'invalid-capital'};

  const targetPct=finite(targetBalance) ? Math.max(0,(Number(targetBalance)-C)/C*100) : 0;
  const stopPct=finite(stopLossBalance) ? Math.max(0,(C-Number(stopLossBalance))/C*100) : 0;
  const initialPct=finite(initialStake) ? Math.max(0,Number(initialStake)/C*100) : 0;
  const maxStakePct=finite(maxStake) ? Math.max(0,Number(maxStake)/C*100) : 0;
  const ddPct=finite(maxDrawdown) ? Math.max(0,Number(maxDrawdown)/C*100) : 0;
  const exposurePct=finite(recoveryExposure) ? Math.max(0,Number(recoveryExposure)/C*100) : 0;
  const streak=Math.max(0,Number(maxLossStreak)||0);

  const targetToStopRatio = stopPct>0 ? targetPct/stopPct : null;

  // Weights intentionally sum to 100. Each component is a structural
  // comparison against an explicit policy limit.
  const components={
    initialStake: ratioScore(initialPct,p.initialStakePctLimit,12),
    maxStake: ratioScore(maxStakePct,p.maxStakePctLimit,28),
    drawdown: ratioScore(ddPct,p.drawdownPctLimit,30),
    exposure: ratioScore(exposurePct,p.exposurePctLimit,20),
    lossStreak: ratioScore(streak,p.lossStreakReference,5),
    targetPressure: targetToStopRatio===null
      ? 0
      : ratioScore(targetToStopRatio,p.targetToStopRatioLimit,5)
  };

  const score=round(clamp(
    Object.values(components).reduce((sum,value)=>sum+value,0),
    0,
    p.scoreMax
  ));

  let level='safe', label='کم‌ریسک';
  if(score>p.bands.highMax){ level='extreme'; label='ریسک بسیار بالا'; }
  else if(score>p.bands.moderateMax){ level='high'; label='ریسک بالا'; }
  else if(score>p.bands.safeMax){ level='moderate'; label='ریسک متوسط'; }

  const warnings=[];
  if(initialPct>p.initialStakePctLimit)
    warnings.push(`Stake اولیه بیش از ${p.initialStakePctLimit}٪ سرمایه است.`);
  if(maxStakePct>p.maxStakePctLimit)
    warnings.push(`بیشینه Stake بیش از ${p.maxStakePctLimit}٪ سرمایه است.`);
  if(ddPct>p.drawdownPctLimit)
    warnings.push(`Drawdown بالقوه بیش از ${p.drawdownPctLimit}٪ سرمایه است.`);
  if(exposurePct>p.exposurePctLimit)
    warnings.push(`Exposure از ${p.exposurePctLimit}٪ سرمایه بیشتر است.`);
  if(targetToStopRatio!==null && targetToStopRatio>p.targetToStopRatioLimit)
    warnings.push('فشار Target نسبت به بودجه Stop Loss بالاست.');
  if(streak>p.lossStreakReference)
    warnings.push(`بیش از ${p.lossStreakReference} باخت پیاپی در طرح دیده می‌شود.`);

  return {
    valid:true,
    score,
    level,
    label,
    components,
    metrics:{
      targetPct:round(targetPct),
      stopPct:round(stopPct),
      initialStakePct:round(initialPct),
      maxStakePct:round(maxStakePct),
      drawdownPct:round(ddPct),
      exposurePct:round(exposurePct),
      targetToStopRatio:targetToStopRatio===null?null:round(targetToStopRatio),
      maxLossStreak:streak
    },
    warnings,
    policy:p,
    methodology:'Deterministic structural score (0–100) using explicit product-policy limits; not a market-risk probability.'
  };
}
