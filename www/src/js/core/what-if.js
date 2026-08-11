import { simulateScenario } from './scenario-simulator.js';

export function buildWhatIfComparison({
  mode,
  capital,
  payout,
  targetProfit,
  targetBalance,
  stopLossBalance,
  plan,
  actualResults,
  hypotheticalResults,
  minStake = 1
}){
  const run = results => simulateScenario({
    mode,
    capital,
    payout,
    targetProfit,
    targetBalance,
    stopLossBalance,
    plan,
    results,
    minStake
  });
  if(!Array.isArray(actualResults) || !Array.isArray(hypotheticalResults) ||
     actualResults.length !== hypotheticalResults.length || actualResults.length === 0){
    return { valid:false, reason:'invalid-results' };
  }
  const actual=run(actualResults);
  const hypothetical=run(hypotheticalResults);
  if(!actual.valid || !hypothetical.valid){
    return { valid:false, reason:!actual.valid ? actual.reason : hypothetical.reason, actual, hypothetical };
  }
  return {
    valid:true,
    actual,
    hypothetical,
    delta:{
      finalBalance:hypothetical.finalBalance-actual.finalBalance,
      profit:hypothetical.profit-actual.profit,
      trades:hypothetical.trades-actual.trades,
      maxDrawdown:hypothetical.maxDrawdown-actual.maxDrawdown
    }
  };
}
