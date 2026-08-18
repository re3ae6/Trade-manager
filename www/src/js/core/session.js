/**
 * Pure session outcome/state helpers. The UI layer owns dialogs and persistence;
 * these helpers only encode the existing trade-state rules so they can be tested.
 */
export function applyTradeOutcome(state, result, stake, payout){
  const next = {
    ...state,
    balance: state.balance,
    streakLoss: state.streakLoss || 0,
    currentStreakCount: state.currentStreakCount || 0,
    nRemaining: state.nRemaining,
    kRemaining: state.kRemaining,
    wins: state.wins || 0,
    losses: state.losses || 0,
    breakevens: state.breakevens || 0,
    trades: state.trades || 0
  };

  if(result === 'W'){
    next.balance += stake * payout;
    next.streakLoss = 0;
    next.currentStreakCount = 0;
    next.kRemaining = Number.isFinite(next.kRemaining) ? next.kRemaining - 1 : next.kRemaining;
    next.nRemaining = Number.isFinite(next.nRemaining) ? next.nRemaining - 1 : next.nRemaining;
    next.wins += 1;
  }else if(result === 'BE'){
    next.breakevens += 1;
    // BE is a real session trade for statistics, but consumes no Masaniello opportunity.
    // Balance, nRemaining and kRemaining remain unchanged.
  }else{
    next.balance -= stake;
    next.streakLoss += stake;
    next.currentStreakCount += 1;
    next.nRemaining = Number.isFinite(next.nRemaining) ? next.nRemaining - 1 : next.nRemaining;
    next.losses += 1;
  }

  next.trades += 1;
  return next;
}

export function replayTradeResults(initialState, results, stakeResolver, payout){
  let state = {...initialState};
  for(const result of results){
    const stake = stakeResolver(state, result);
    state = applyTradeOutcome(state, result, stake, payout);
  }
  return state;
}

export function sessionEndAction(choice){
  if(choice === 'primary') return 'save-and-delete';
  if(choice === 'secondary') return 'delete-without-save';
  return 'continue';
}
