import { computePlan, masanielloStake, guaranteedWorstCaseFinal } from './masaniello.js';
import { calculateSimpleNextStake } from './simple.js';

const SIMPLE_PROFILES = [
  { risk: 'low', n: 20, k: 14, label: 'کم‌ریسک', description: 'معاملات بیشتر، فشار هر معامله کمتر' },
  { risk: 'medium', n: 15, k: 10, label: 'ریسک متوسط', description: 'تعادل بین تعداد معاملات و فشار ریسک' },
  { risk: 'high', n: 10, k: 7, label: 'پرریسک', description: 'معاملات کمتر، فشار هر معامله بیشتر' }
];

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

export function buildSimplePlan(profile, capital, payoutPct, targetProfit, floor=1){
  const payout = payoutPct / 100;
  if(!Number.isFinite(capital) || !Number.isFinite(payout) || !Number.isFinite(targetProfit) || capital <= 0 || payout <= 0 || targetProfit <= 0) return { ...profile, valid:false };
  const profitPerWin = targetProfit / profile.k;
  let balance = capital;
  let streakLoss = 0;
  let maxStake = 0;
  let worstLoss = 0;
  const stakes = [];
  for(let i=0;i<profile.n;i++){
    const result = calculateSimpleNextStake({
      payout, targetProfit:profitPerWin, streakLoss, floor, balance,
      stopLossBalance: capital - capital
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
      balance += stake * payout;
      streakLoss = 0;
    }
  }
  const stopLossAmount = stakes.slice(0, profile.n-profile.k).reduce((a,b)=>a+b,0);
  const stopLossBalance = Math.max(0, capital - stopLossAmount);
  return {
    ...profile, valid:true, profitPerWin, maxStake,
    stopLossAmount, stopLossBalance,
    worstLoss:stopLossAmount,
    targetBalance:capital+targetProfit,
    expectedFinal:balance,
    stakesPreview:stakes
  };
}

export function buildSimplePlans(capital,payoutPct,targetProfit,floor=1){
  return SIMPLE_PROFILES.map(profile => buildSimplePlan(profile,capital,payoutPct,targetProfit,floor));
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
