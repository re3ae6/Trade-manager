import { csvEscape } from './format.js';

export function computeHistoryWithCumulativeStats(sessionHistory){
  let cumWins = 0, cumTrades = 0, prevRate = null;
  return sessionHistory.map(s => {
    cumWins += Number(s.wins || 0);
    cumTrades += Number(s.trades || 0);
    const cumulativeWinRate = cumTrades ? (cumWins / cumTrades) * 100 : 0;
    let trend = 'flat';
    if(prevRate !== null){
      if(cumulativeWinRate > prevRate + 0.005) trend = 'up';
      else if(cumulativeWinRate < prevRate - 0.005) trend = 'down';
    }
    prevRate = cumulativeWinRate;
    return {...s, cumulativeWinRate, trend};
  });
}

export function buildHistoryCSV(sessionHistory){
  const enriched = computeHistoryWithCumulativeStats(sessionHistory);
  const header = ['Session','Mode','Trades','Wins','Losses','Initial','Final','Profit','DateTime','CumulativeWinRate%','Trend'];
  const rows = enriched.map(s => [s.session,s.mode,s.trades,s.wins,s.losses,s.initial.toFixed(2),s.finalBalance.toFixed(2),s.profit.toFixed(2),s.date,s.cumulativeWinRate.toFixed(2),s.trend]);
  const signatureRow = ['re3ae6'];
  return [header, ...rows, signatureRow].map(r => r.map(csvEscape).join(',')).join('\r\n');
}
