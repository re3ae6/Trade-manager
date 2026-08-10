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

  return {
    sessions: completedSessions + (live ? 1 : 0),
    completedSessions,
    trades,
    wins,
    losses,
    breakevens,
    winRate,
    netProfit,
    averageSessionProfit,
    bestSession,
    worstSession,
    currentBalance,
    maxDrawdownDollar,
    maxDrawdownPercent,
    drawdownBasis: 'session-end'
  };
}
