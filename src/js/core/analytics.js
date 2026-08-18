function safeNumber(value, fallback = 0){
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function computePerformanceStats(sessionHistory = [], currentSession = null){
  const history = Array.isArray(sessionHistory) ? sessionHistory : [];
  const closedTrades = history.reduce((sum, s) => sum + safeNumber(s.trades), 0);
  const closedWins = history.reduce((sum, s) => sum + safeNumber(s.wins), 0);
  const closedLosses = history.reduce((sum, s) => sum + safeNumber(s.losses), 0);
  const closedBE = history.reduce((sum, s) => sum + safeNumber(s.breakevens), 0);
  const closedProfit = history.reduce((sum, s) => sum + safeNumber(s.profit), 0);
  const closedWinProfit = history.reduce((sum, s) => sum + safeNumber(s.winProfit), 0);
  const closedLossAmount = history.reduce((sum, s) => sum + Math.max(0, safeNumber(s.lossAmount)), 0);
  const closedWinCount = history.reduce((sum, s) => sum + safeNumber(s.wins), 0);
  const closedLossCount = history.reduce((sum, s) => sum + safeNumber(s.losses), 0);
  const hasStakeData = history.some(s => Number.isFinite(Number(s.averageStake)) || Number.isFinite(Number(s.maxStake)));
  const averageStake = hasStakeData
    ? (() => { const weighted = history.reduce((sum,s) => sum + safeNumber(s.averageStake) * safeNumber(s.trades), 0); const count = history.reduce((sum,s) => sum + safeNumber(s.trades), 0); return count ? weighted / count : 0; })()
    : null;
  const maxStake = hasStakeData ? Math.max(...history.map(s => safeNumber(s.maxStake)), 0) : null;
  const maxLossStreak = history.some(s => Number.isFinite(Number(s.maxLossStreak)))
    ? Math.max(...history.map(s => safeNumber(s.maxLossStreak)), 0) : null;
  const maxWinStreak = history.some(s => Number.isFinite(Number(s.maxWinStreak)))
    ? Math.max(...history.map(s => safeNumber(s.maxWinStreak)), 0) : null;

  const live = currentSession && safeNumber(currentSession.trades) > 0 ? currentSession : null;
  const trades = closedTrades + (live ? safeNumber(live.trades) : 0);
  const wins = closedWins + (live ? safeNumber(live.wins) : 0);
  const losses = closedLosses + (live ? safeNumber(live.losses) : 0);
  const breakevens = closedBE + (live ? safeNumber(live.breakevens) : 0);
  const netProfit = closedProfit + (live ? safeNumber(live.profit) : 0);

  const winRate = trades > 0 ? (wins / trades) * 100 : 0;
  const completedSessions = history.length;
  const averageSessionProfit = completedSessions > 0 ? closedProfit / completedSessions : null;

  let bestSession = null;
  let worstSession = null;
  for(const session of history){
    const profit = safeNumber(session.profit);
    if(!bestSession || profit > bestSession.profit) bestSession = { session: session.session, profit };
    if(!worstSession || profit < worstSession.profit) worstSession = { session: session.session, profit };
  }

  // Equity points are session-end balances. If a session is active, its
  // current balance is appended as a live point. This intentionally avoids
  // inventing intratrade drawdown from historical data that is not stored.
  const equity = [];
  if(history.length && Number.isFinite(Number(history[0].initial))) equity.push(Number(history[0].initial));
  history.forEach(s => equity.push(safeNumber(s.finalBalance)));
  if(live){
    if(Number.isFinite(Number(live.initial)) && (equity.length === 0 || live.initial !== equity[equity.length - 1])) {
      equity.push(Number(live.initial));
    }
    if(Number.isFinite(Number(live.finalBalance))) equity.push(Number(live.finalBalance));
  }

  let peak = null;
  let maxDrawdownDollar = 0;
  let peakAt = null;
  equity.forEach((balance, index) => {
    if(peak === null || balance > peak){
      peak = balance;
      peakAt = index;
    }
    if(peak !== null){
      maxDrawdownDollar = Math.max(maxDrawdownDollar, peak - balance);
    }
  });
  const maxDrawdownPercent = peak && peak > 0 ? (maxDrawdownDollar / peak) * 100 : 0;

  const currentBalance = live && Number.isFinite(Number(live.finalBalance))
    ? Number(live.finalBalance)
    : (history.length ? safeNumber(history[history.length - 1].finalBalance) : null);
  const grossWin = closedWinProfit > 0 ? closedWinProfit : Math.max(0, closedProfit + closedLossAmount);
  const grossLoss = closedLossAmount > 0 ? closedLossAmount : Math.max(0, grossWin - closedProfit);
  const averageWin = closedWinCount > 0 ? grossWin / closedWinCount : 0;
  const averageLoss = closedLossCount > 0 ? grossLoss / closedLossCount : 0;
  const beRate = trades > 0 ? breakevens / trades * 100 : 0;
  const lossRate = trades > 0 ? losses / trades * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);

  return {
    sessions: completedSessions + (live ? 1 : 0),
    completedSessions,
    trades,
    wins,
    losses,
    breakevens,
    winRate,
    beRate,
    lossRate,
    averageWin,
    averageLoss,
    profitFactor,
    netProfit,
    averageSessionProfit,
    bestSession,
    worstSession,
    currentBalance,
    averageStake,
    maxStake,
    maxLossStreak,
    maxWinStreak,
    maxDrawdownDollar,
    maxDrawdownPercent,
    drawdownBasis: 'session-end'
  };
}
