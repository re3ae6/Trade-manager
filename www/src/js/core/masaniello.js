let masaTable = null;
let masaTableKey = '';

export function buildMasaTableFor(n, k, Q){
  const key = n+'_'+k+'_'+Q.toFixed(6);
  if(masaTableKey === key && masaTable) return masaTable;
  const f = [];
  for(let m=0;m<=n;m++){ f[m] = new Array(k+1).fill(null); }
  for(let m=n;m>=0;m--){
    for(let c=0;c<=k;c++){
      const w = k-c, r = n-m;
      if(w<0 || w>r){ f[m][c] = null; continue; }
      if(w===0){ f[m][c] = 1; continue; }
      if(w===r){ f[m][c] = Math.pow(Q,w); continue; }
      const fWin = f[m+1][c+1], fLose = f[m+1][c];
      f[m][c] = (Q*fLose*fWin) / (fLose + (Q-1)*fWin);
    }
  }
  masaTable = f;
  masaTableKey = key;
  return f;
}

export function masaTargetMultiplier(n, k, Q){
  if(n<=0 || k<=0 || k>n || Q<=1) return null;
  const t = buildMasaTableFor(n, k, Q);
  return t[0] ? t[0][0] : null;
}

export function masanielloStake(C, nRem, kRem, Q, floor, nTotal, kTotal){
  if(!Number.isFinite(C) || !Number.isFinite(Q) || !Number.isFinite(floor) || !Number.isFinite(nRem) || !Number.isFinite(kRem) || !Number.isFinite(nTotal) || !Number.isFinite(kTotal)){
    return {stake:0, reason:'target-impossible'};
  }
  if(kRem <= 0) return {stake:0, reason:'target-reached'};
  if(nRem <= 0) return {stake:0, reason:'no-trades-left'};
  if(kRem > nRem) return {stake:0, reason:'target-impossible'};
  if(Q <= 1) return {stake:0, reason:'invalid-payout'};
  if(C <= 0) return {stake:0, reason:'balance-depleted'};
  if(kRem === nRem){
    return {stake: Math.round(C*100)/100, reason:'ok'};
  }
  const t = buildMasaTableFor(nTotal, kTotal, Q);
  const m = nTotal - nRem;
  const c = kTotal - kRem;
  const fLose = t[m+1] ? t[m+1][c] : null;
  const fWin  = t[m+1] ? t[m+1][c+1] : null;
  if(fLose===null || fWin===null) return {stake:0, reason:'target-impossible'};
  const fraction = 1 - (Q*fWin) / (fLose + (Q-1)*fWin);
  let stake = C*fraction;
  if(!Number.isFinite(stake)) return {stake:0, reason:'target-impossible'};
  if(stake < floor){
    if(C < floor) return {stake:0, reason:'insufficient-balance'};
    stake = floor;
  }
  stake = Math.min(stake, C);
  const roundedStake = Math.round(stake*100)/100;
  if(!Number.isFinite(roundedStake)) return {stake:0, reason:'target-impossible'};
  return {stake: roundedStake, reason:'ok'};
}

export function guaranteedWorstCaseFinal(C, n, k, Q){
  if(n<=0 || k<=0 || k>n || Q<=1 || C<=0) return null;
  const mult = masaTargetMultiplier(n, k, Q);
  return mult!==null ? C*mult : null;
}

export function simulateAllWinFinal(C, n, Q, floor){
  if(C < floor) return null;
  return C * Math.pow(Q, n);
}

export function findHighRiskN(C, Q, targetCapital, floor){
  for(let n=1;n<=300;n++){
    const f = simulateAllWinFinal(C,n,Q,floor);
    if(f!==null && f>=targetCapital) return n;
  }
  return null;
}

export function findMinK(C, n, Q, targetCapital){
  for(let k=1;k<=n;k++){
    const f = guaranteedWorstCaseFinal(C,n,k,Q);
    if(f!==null && f>=targetCapital) return k;
  }
  return null;
}

export function computePlan(risk, C, payoutPct, target, floor){
  const Q = 1 + Math.max(0.01, payoutPct) / 100;
  const targetCapital = C + target;
  const highN = findHighRiskN(C,Q,targetCapital,floor);
  if(highN === null) return null;
  if(risk === 'high') return {n:highN,k:highN};
  const minBuffer = risk === 'medium' ? 1 : 2;
  let n = risk === 'medium' ? Math.max(highN+1, highN*2) : Math.max(highN+2, highN*4);
  n = Math.min(n,300);
  let k = findMinK(C,n,Q,targetCapital);
  if(k === null) return {n:highN,k:highN};
  while((n-k) < minBuffer && n < 300){
    n++;
    const k2 = findMinK(C,n,Q,targetCapital);
    if(k2 === null) break;
    k = k2;
  }
  return {n,k};
}
