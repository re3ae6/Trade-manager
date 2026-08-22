function num(value, fallback = 0){
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function computeSessionStatistics(trades = [], initialBalance = 0){
  const rows = Array.isArray(trades) ? trades : [];
  let wins = 0, losses = 0, breakevens = 0;
  let currentWinStreak = 0, currentLossStreak = 0;
  let maxWinStreak = 0, maxLossStreak = 0;
  let peak = num(initialBalance);
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;

  for(const trade of rows){
    if(trade.result === 'W'){
      wins += 1;
      currentWinStreak += 1;
      currentLossStreak = 0;
      maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
    }else if(trade.result === 'L'){
      losses += 1;
      currentLossStreak += 1;
      currentWinStreak = 0;
      maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
    }else if(trade.result === 'BE'){
      breakevens += 1;
      currentWinStreak = 0;
      currentLossStreak = 0;
    }

    const balance = Number(trade.balance);
    if(Number.isFinite(balance)){
      if(balance > peak) peak = balance;
      const drawdown = peak - balance;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
      if(peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, (drawdown / peak) * 100);
    }
  }

  const tradesCount = rows.length;
  const finalBalance = rows.length && Number.isFinite(Number(rows.at(-1).balance))
    ? Number(rows.at(-1).balance)
    : num(initialBalance);
  const profit = finalBalance - num(initialBalance);

  return {
    trades: tradesCount,
    wins,
    losses,
    breakevens,
    winRate: tradesCount ? wins / tradesCount * 100 : 0,
    beRate: tradesCount ? breakevens / tradesCount * 100 : 0,
    lossRate: tradesCount ? losses / tradesCount * 100 : 0,
    currentWinStreak,
    currentLossStreak,
    maxWinStreak,
    maxLossStreak,
    maxDrawdown,
    maxDrawdownPct,
    initialBalance: num(initialBalance),
    finalBalance,
    profit,
    returnPct: num(initialBalance) > 0 ? profit / num(initialBalance) * 100 : 0
  };
}
