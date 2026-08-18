import { simulateScenario } from './scenario-simulator.js';
import { simulateRecoverySequence } from './recovery.js';

function seededRandom(seed){
  let s=(Number(seed)>>>0)||1;
  return ()=>{ s=(1664525*s+1013904223)>>>0; return s/4294967296; };
}

function normalizeProbabilities({win=.5, loss=.25, be=.25}={}){
  const values=[Number(win),Number(loss),Number(be)];
  if(values.some(v=>!Number.isFinite(v)||v<0) || Math.abs(values.reduce((a,b)=>a+b,0)-1)>1e-9){
    return null;
  }
  return {win:values[0],loss:values[1],be:values[2]};
}

export function buildStressScenario(kind, trades=12, seed=42, probabilities){
  const n=Math.max(1,Math.floor(Number(trades)||12));
  if(kind==='best') return Array(n).fill('W');
  if(kind==='worst') return Array(n).fill('L');
  if(kind==='normal') return Array.from({length:n},(_,i)=>['W','W','L','BE'][i%4]);
  if(kind==='custom') return [];
  const p=normalizeProbabilities(probabilities);
  if(!p) return null;
  const rnd=seededRandom(seed);
  return Array.from({length:n},()=>{
    const x=rnd();
    if(x<p.win) return 'W';
    if(x<p.win+p.loss) return 'L';
    return 'BE';
  });
}

function runScenarioSet(build, customResults){
  const scenarios=[];
  for(const kind of ['best','normal','worst','custom','random']){
    const results=kind==='custom' ? customResults : build(kind);
    if(!Array.isArray(results) || results.some(v=>!['W','BE','L'].includes(v))) continue;
    scenarios.push({kind,results});
  }
  return scenarios;
}

export function stressTestPlan({mode,capital,payout,targetProfit,stopLossBalance,plan,minStake=1,seed=42,trades=12,customResults=[],probabilities}={}){
  if(!plan || plan.valid===false) return {valid:false,reason:'invalid-plan',scenarios:[]};
  const randomProbe=buildStressScenario('random',trades,seed,probabilities);
  if(!randomProbe) return {valid:false,reason:'invalid-probabilities',scenarios:[]};
  const built=runScenarioSet(kind=>kind==='random'?randomProbe:buildStressScenario(kind,trades,seed,probabilities),customResults);
  const scenarios=built.map(({kind,results})=>({
    kind,results,
    simulation:simulateScenario({mode,capital,payout,targetProfit,stopLossBalance,plan,results,minStake})
  }));
  return {valid:true,scenarios,seed,trades,probabilities:normalizeProbabilities(probabilities)};
}

export function stressTestRecovery({capital,payout,targetProfit,stopLossBalance,maxStake,maxDrawdown,maxAttempts=3,minStake=1,seed=42,trades=12,customResults=[],probabilities}={}){
  const randomProbe=buildStressScenario('random',trades,seed,probabilities);
  if(!randomProbe) return {valid:false,reason:'invalid-probabilities',scenarios:[]};
  const built=runScenarioSet(kind=>kind==='random'?randomProbe:buildStressScenario(kind,trades,seed,probabilities),customResults);
  const scenarios=built.map(({kind,results})=>({
    kind,results,
    simulation:simulateRecoverySequence({capital,payout,targetProfit,stopLossBalance,maxStake,maxDrawdown,maxAttempts,minStake,results})
  }));
  return {valid:true,scenarios,seed,trades,probabilities:normalizeProbabilities(probabilities)};
}
