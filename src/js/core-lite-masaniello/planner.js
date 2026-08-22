import { computePlan, buildLitePlan, masanielloStake, guaranteedWorstCaseFinal } from './masaniello-plan-engine.js';
import { calculateSimpleNextStake } from './simple.js';

const SIMPLE_PROFILES = [
  { risk: 'low', n: 20, k: 14, label: 'کم‌ریسک', description: 'معاملات بیشتر، فشار هر معامله کمتر' },
  { risk: 'medium', n: 15, k: 10, label: 'ریسک متوسط', description: 'تعادل بین تعداد معاملات و فشار ریسک' },
  { risk: 'high', n: 10, k: 7, label: 'پرریسک', description: 'معاملات کمتر، فشار هر معامله بیشتر' }
];


export function buildMasanielloLitePlan(capital, payoutPct, targetProfit, floor = 1) {
  return buildLitePlan({
    capital,
    payoutPct,
    targetProfit,
    floor,
    maxN: 12
  });
}

export function buildMasanielloPlans(capital, payoutPct, targetProfit, floor = 1){
  if(!Number.isFinite(capital) || !Number.isFinite(payoutPct) || !Number.isFinite(targetProfit) || capital <= 0 || payoutPct <= 0 || targetProfit <= 0) return [];
  return ['low','medium','high'].map(risk => {
    const plan = computePlan(risk, capital, payoutPct, targetProfit, floor);
    if(!plan) return {risk, valid:false};
    const Q = 1 + payoutPct / 100;
    const worst = guaranteedWorstCaseFinal(capital, plan.n, plan.k, Q);
    return {
      risk, valid:true, n:plan.n, k:plan.k, losses:plan.n-plan.k,
      targetBalance:capital+targetProfit,
      worstCaseFinal:worst,
      maxStakeHint:null,
      description:risk === 'low' ? 'معاملات بیشتر و فشار کمتر روی هر معامله' : risk === 'medium' ? 'تعادل بین تعداد معاملات و فشار ریسک' : 'معاملات کمتر و فشار بیشتر روی هر معامله'
    };
  });
}

export function buildSimplePlan(profile, capital, payoutPct, targetProfit, floor=1, configuredStopLossBalance=null){
  const payout = payoutPct / 100;
  if(!Number.isFinite(capital) || !Number.isFinite(payout) || !Number.isFinite(targetProfit) || !Number.isFinite(configuredStopLossBalance) || capital <= 0 || payout <= 0 || targetProfit <= 0 || configuredStopLossBalance < 0 || configuredStopLossBalance > capital) return { ...profile, valid:false };
  const profitPerWin = targetProfit / profile.k;
  let balance = capital;
  let streakLoss = 0;
  let maxStake = 0;
  let worstLoss = 0;
  const stakes = [];
  for(let i=0;i<profile.n;i++){
    const result = calculateSimpleNextStake({
      payout, targetProfit:profitPerWin, streakLoss, floor, balance,
      stopLossBalance: configuredStopLossBalance
    });
    if(result.reason !== 'ok' || !Number.isFinite(result.stake) || result.stake <= 0){
      return {...profile, valid:false, profitPerWin, reason:result.reason};
    }
    const stake = result.stake;
    stakes.push(stake);
    maxStake = Math.max(maxStake, stake);
    balance -= stake;
    worstLoss = Math.max(worstLoss, capital - balance);
    // Planner stress-test assumes the first n-k outcomes are losses and the
    // remaining k are wins. This is a planning preview, not a new engine.
    if(i < profile.n - profile.k){
      streakLoss += stake;
    } else {
      balance += stake * (1 + payout);
      streakLoss = 0;
    }
  }
  const derivedStopLossAmount = stakes.slice(0, profile.n-profile.k).reduce((a,b)=>a+b,0);
  const stopLossAmount = Math.max(0, capital - configuredStopLossBalance);
  return {
    ...profile, valid:true, profitPerWin, maxStake,
    stopLossAmount, stopLossBalance: configuredStopLossBalance,
    worstLoss:stopLossAmount,
    targetBalance:capital+targetProfit,
    expectedFinal:balance,
    stakesPreview:stakes
  };
}


/*
 * LOW_CAPITAL_FALLBACK_V5
 *
 * Narrow executable fallback for very small accounts.
 *
 * Normal Simple plans always have priority.
 * This fallback is used only when ALL normal profiles fail.
 *
 * Safety:
 * - capital <= 15
 * - configured minimum stake is never reduced
 * - stake never exceeds balance
 * - configured stop loss is never crossed
 * - no recovery / Martingale is introduced
 */
function buildLowCapitalFallbackPlans(
  capital,
  payoutPct,
  targetProfit,
  floor = 1,
  stopLossBalance = 0
) {
  if (
    !Number.isFinite(capital) ||
    !Number.isFinite(payoutPct) ||
    !Number.isFinite(targetProfit) ||
    !Number.isFinite(floor) ||
    !Number.isFinite(stopLossBalance) ||
    capital <= 0 ||
    capital > 15 ||
    payoutPct <= 0 ||
    payoutPct >= 100 ||
    targetProfit <= 0 ||
    floor <= 0 ||
    stopLossBalance < 0 ||
    stopLossBalance > capital
  ) {
    return [];
  }

  const payout = payoutPct / 100;

  /*
   * A single winning trade must at least cover the requested
   * target profit. The configured minimum remains a hard floor.
   */
  const stake = Math.max(
    floor,
    targetProfit / payout
  );

  if (!Number.isFinite(stake)) return [];
  if (stake > capital) return [];
  if (capital - stake < stopLossBalance) return [];

  return [{
    risk: 'low',
    n: 1,
    k: 1,
    losses: 0,
    label: 'کم‌ریسک',
    description: 'برنامه اضطراری برای سرمایه کم؛ حداقل یک معامله قابل اجرا',
    valid: true,

    profitPerWin: targetProfit,
    maxStake: stake,

    stopLossBalance,
    stopLossAmount: Math.max(0, capital - stopLossBalance),

    worstLoss: stake,
    targetBalance: capital + targetProfit,

    expectedFinal: capital + stake * payout,
    stakesPreview: [stake],

    lowCapitalFallback: true,
    fallbackReason: 'normal-plans-unavailable',
    fallbackCapital: capital
  }];
}

export function buildSimplePlans(capital,payoutPct,targetProfit,floor=1,stopLossBalance=null){
  const normalPlans = SIMPLE_PROFILES.map(profile =>
    buildSimplePlan(
      profile,
      capital,
      payoutPct,
      targetProfit,
      floor,
      stopLossBalance
    )
  );

  /*
   * Preserve existing behavior whenever at least one normal
   * executable plan exists.
   */
  if (normalPlans.some(plan => plan.valid)) {
    return normalPlans;
  }

  /*
   * Only when ALL normal plans fail do we offer the narrow
   * low-capital executable fallback.
   */
  const safeStopLoss =
    Number.isFinite(stopLossBalance) ? stopLossBalance : 0;

  const fallbackPlans = buildLowCapitalFallbackPlans(
    capital,
    payoutPct,
    targetProfit,
    floor,
    safeStopLoss
  );

  return fallbackPlans.length > 0
    ? fallbackPlans
    : normalPlans;
}

export function validateMasanielloCustom(capital,payoutPct,targetProfit,n,losses,floor=1){
  const k = n - losses;
  if(!Number.isInteger(n) || !Number.isInteger(losses) || n < 1 || losses < 0 || losses >= n) return {valid:false, reason:'n/k'};
  const Q = 1 + payoutPct/100;
  const worst = guaranteedWorstCaseFinal(capital,n,k,Q);
  if(worst === null) return {valid:false, reason:'impossible'};
  const target = capital + targetProfit;
  if(worst + 0.005 < target) return {valid:false, reason:'target'};
  const preview=[];
  let C=capital, nr=n, kr=k, maxStake=0;
  while(nr>0 && kr>0 && preview.length<n){
    const r=masanielloStake(C,nr,kr,Q,floor,n,k);
    if(r.reason!=='ok') return {valid:false,reason:r.reason};
    maxStake=Math.max(maxStake,r.stake); preview.push(r.stake);
    // Worst-case sequence: losses first, then wins, for a transparent stress preview.
    if(preview.length <= losses){ C-=r.stake; nr--; }
    else { C += r.stake*(Q-1); nr--; kr--; }
  }
  return {valid:true,n,k,losses,worstCaseFinal:worst,targetBalance:target,maxStake,stakesPreview:preview};
}
