import { buildSimplePlans, buildMasanielloPlans } from './planner.js';
import { simulateScenario } from './scenario-simulator.js';
import { calculateRecoveryStake, simulateRecoverySequence } from './recovery.js';
import { buildStressScenario } from './stress-testing.js';
import { scoreRisk } from './risk-engine.js';

function money(v){ return Number.isFinite(Number(v)) ? Number(v) : 0; }
function round(v){ return Math.round(Number(v) * 100) / 100; }

function summarizeSimulation(simulation, capital, targetBalance){
  const rows = Array.isArray(simulation?.rows) ? simulation.rows.filter(r => r.executed) : [];
  const stakes = rows.map(r => Number(r.stake)).filter(Number.isFinite);
  const targetHit = Number(simulation?.finalBalance) >= Number(targetBalance) - 1e-9;
  const stopLossHit = simulation?.lockReason === 'stoploss';
  const finalBalance = round(simulation?.finalBalance ?? simulation?.balance ?? capital);
  return {
    initialStake: simulation?.initialStake == null ? null : round(simulation.initialStake),
    finalBalance,
    profit: round(finalBalance - Number(capital)),
    trades: Number(simulation?.trades ?? rows.length),
    wins: Number(simulation?.wins ?? rows.filter(r => r.result === 'W').length),
    breakevens: Number(simulation?.breakevens ?? rows.filter(r => r.result === 'BE').length),
    losses: Number(simulation?.losses ?? rows.filter(r => r.result === 'L').length),
    winRate: round(simulation?.winRate ?? 0),
    maxStake: round(Math.max(0, ...stakes)),
    averageStake: round(stakes.length ? stakes.reduce((a,b) => a+b, 0) / stakes.length : 0),
    maxDrawdown: round(simulation?.maxDrawdown ?? 0),
    maxLossStreak: Number(simulation?.maxLossStreak ?? 0),
    targetHit,
    stopLossHit,
    locked: Boolean(simulation?.locked),
    lockReason: simulation?.lockReason ?? null
  };
}

function compareRow({strategy, plan, scenarioSimulation, worstSimulation, capital, targetBalance, stopLossBalance, recoveryExposure=0}){
  const scenario = summarizeSimulation(scenarioSimulation, capital, targetBalance);
  const worst = summarizeSimulation(worstSimulation, capital, targetBalance);
  const risk = scoreRisk({
    capital,
    targetBalance,
    stopLossBalance,
    initialStake: scenario.initialStake,
    maxStake: Math.max(scenario.maxStake, worst.maxStake),
    maxDrawdown: Math.max(scenario.maxDrawdown, worst.maxDrawdown),
    maxLossStreak: Math.max(scenario.maxLossStreak, worst.maxLossStreak),
    recoveryExposure
  });
  return {
    strategy,
    valid:true,
    plan,
    scenario,
    worstCase:worst,
    risk,
    initialStake:scenario.initialStake,
    averageStake:scenario.averageStake,
    maxStake:Math.max(scenario.maxStake, worst.maxStake),
    maxDrawdown:Math.max(scenario.maxDrawdown, worst.maxDrawdown),
    worstCaseFinal:worst.finalBalance,
    targetHit:scenario.targetHit,
    stopLossHit:scenario.stopLossHit
  };
}

function addInitialStake(simulation){
  const first = Array.isArray(simulation?.rows) ? simulation.rows.find(r => r.executed) : null;
  return first ? Number(first.stake) : null;
}

export function compareStrategies({
  capital,
  payoutPct,
  targetBalance,
  stopLossBalance,
  minStake=1,
  scenario=['L','L','BE','W','W'],
  maxRecoveryAttempts=3,
  maxRecoveryStake=Infinity
}){
  const C=Number(capital);
  const target=Number(targetBalance);
  const payoutPctNumber=Number(payoutPct);
  const payout=payoutPctNumber/100;
  const targetProfit=target-C;
  if(!Number.isFinite(C)||C<=0||!Number.isFinite(payout)||payout<=0||!Number.isFinite(target)||target<=C){
    return {valid:false,reason:'invalid-input'};
  }
  if(!Number.isFinite(Number(stopLossBalance)) || Number(stopLossBalance)<0 || Number(stopLossBalance)>C){
    return {valid:false,reason:'invalid-stoploss'};
  }

  const requestedScenario = Array.isArray(scenario) ? scenario.map(v => String(v).toUpperCase()) : [];
  if(requestedScenario.some(v => !['W','BE','L'].includes(v))){
    return {valid:false,reason:'invalid-scenario'};
  }

  const stressTrades = Math.max(12, requestedScenario.length, 20);
  const worstScenario = buildStressScenario('worst', stressTrades);
  const rows=[];

  const simplePlans=buildSimplePlans(C,payoutPctNumber,targetProfit,minStake,Number(stopLossBalance));
  const simple=simplePlans.find(p=>p.risk==='medium'&&p.valid) || simplePlans.find(p=>p.valid);
  if(simple){
    const simulation=simulateScenario({mode:'simple',capital:C,payout,targetProfit,stopLossBalance:Number(stopLossBalance),plan:simple,results:requestedScenario,minStake});
    const worstSimulation=simulateScenario({mode:'simple',capital:C,payout,targetProfit,stopLossBalance:Number(stopLossBalance),plan:simple,results:worstScenario,minStake});
    simulation.initialStake=addInitialStake(simulation);
    worstSimulation.initialStake=addInitialStake(worstSimulation);
    rows.push(compareRow({strategy:'Simple',plan:simple,scenarioSimulation:simulation,worstSimulation,capital:C,targetBalance:target,stopLossBalance:Number(stopLossBalance)}));
  }

  const masaPlans=buildMasanielloPlans(C,payoutPctNumber,targetProfit,minStake);
  const masa=masaPlans.find(p=>p.risk==='medium'&&p.valid) || masaPlans.find(p=>p.valid);
  if(masa){
    const simulation=simulateScenario({mode:'masaniello',capital:C,payout,targetProfit,stopLossBalance:Number(stopLossBalance),plan:masa,results:requestedScenario,minStake});
    const worstSimulation=simulateScenario({mode:'masaniello',capital:C,payout,targetProfit,stopLossBalance:Number(stopLossBalance),plan:masa,results:worstScenario,minStake});
    simulation.initialStake=addInitialStake(simulation);
    worstSimulation.initialStake=addInitialStake(worstSimulation);
    rows.push(compareRow({strategy:'Masaniello',plan:masa,scenarioSimulation:simulation,worstSimulation,capital:C,targetBalance:target,stopLossBalance:Number(stopLossBalance)}));
  }

  const recoveryMaxDrawdown=Math.max(0,C-Number(stopLossBalance));
  const recoveryInitial=calculateRecoveryStake({
    balance:C,payout,accumulatedLoss:0,targetProfit,stopLossBalance:Number(stopLossBalance),
    maxStake:maxRecoveryStake,maxDrawdown:recoveryMaxDrawdown,maxAttempts:maxRecoveryAttempts,minStake
  });
  const rec=simulateRecoverySequence({
    capital:C,payout,targetProfit,stopLossBalance:Number(stopLossBalance),maxStake:maxRecoveryStake,
    maxDrawdown:recoveryMaxDrawdown,maxAttempts:maxRecoveryAttempts,minStake,results:requestedScenario
  });
  const recWorst=simulateRecoverySequence({
    capital:C,payout,targetProfit,stopLossBalance:Number(stopLossBalance),maxStake:maxRecoveryStake,
    maxDrawdown:recoveryMaxDrawdown,maxAttempts:maxRecoveryAttempts,minStake,results:worstScenario
  });
  rec.initialStake=recoveryInitial.stake ?? null;
  recWorst.initialStake=recoveryInitial.stake ?? null;
  const recoveryPlan={
    maxAttempts:maxRecoveryAttempts,
    maxStake:maxRecoveryStake,
    maxDrawdown:recoveryMaxDrawdown,
    stopLossBalance:Number(stopLossBalance)
  };
  const recoveryRow=compareRow({
    strategy:'Recovery',
    plan:recoveryPlan,
    scenarioSimulation:rec,
    worstSimulation:recWorst,
    capital:C,
    targetBalance:target,
    stopLossBalance:Number(stopLossBalance),
    recoveryExposure:recWorst.maxStake
  });
  recoveryRow.valid=recoveryInitial.valid && recoveryInitial.canRecover;
  if(!recoveryRow.valid) recoveryRow.invalidReason=recoveryInitial.reason;
  rows.push(recoveryRow);

  return {
    valid:true,
    inputs:{capital:C,payoutPct:payoutPctNumber,payout,targetBalance:target,targetProfit,stopLossBalance:Number(stopLossBalance),minStake},
    scenario:requestedScenario,
    worstScenario,
    rows
  };
}
