import { formatNumber, money, formatDateTime } from './core/format.js';
import { computePlan, guaranteedWorstCaseFinal, masanielloStake } from './core/masaniello.js';
import { calculateSimpleNextStake } from './core/simple.js';
import { generatePlanId, resolvePlanTarget, computeTradingPlanStats as computeTradingPlanStatsPure } from './core/trading-plan.js';
import { computeHistoryWithCumulativeStats as computeHistoryWithCumulativeStatsPure, buildHistoryCSV } from './core/history.js';
import { readStoredState, writeStoredState } from './storage/state.js';

/* =====================================================
   STATE (shared between both modes — only one mode's
   engine runs at a time, so trades/balance/locked are shared)
===================================================== */
const MIN_STAKE = 1; // Pocket Option rule: minimum $1 per trade — not user-editable
const APP_VERSION = '2.1.0';

let mode = 'simple';               // 'simple' | 'masaniello'
let trades = [];                   // {no, result, amount, ret, balance}
let balance = 0;
let locked = false;

let sessionCounter = 1;
let sessionHistory = [];           // {session, mode, trades, wins, losses, initial, finalBalance, profit, date, endedAt}
let sessionStartTime = null;

// Trading Plan — independent long-term planning layer (see Trading Plan architecture doc).
// Never read by, or written from, Simple Mode / Masaniello / recovery / stake logic.
let tradingPlan = null;

// simple-mode-only runtime state
let streakLoss = 0;
let currentStreakCount = 0;

// masaniello-mode-only runtime state
let riskLevel = 'medium';
let capital0 = 0, payout0 = 0, target0 = 0;
let planned0 = 0, kRequired0 = 0;
let nRemaining = 0, kRemaining = 0;

/* =====================================================
   PERSISTENCE — auto-save/restore across refresh & tab
   close. Everything lives in localStorage; failures
   (private browsing, storage disabled, quota) are caught
   and silently ignored so the app keeps working without
   persistence rather than crashing.
===================================================== */

function saveState(){
  try{
    const state = {
      mode, trades, balance, locked, sessionCounter, sessionHistory, sessionStartTime,
      streakLoss, currentStreakCount,
      riskLevel, capital0, payout0, target0, planned0, kRequired0, nRemaining, kRemaining,
      tradingPlan,
      inputs: {
        initialCapital: document.getElementById('initialCapital')?.value ?? '',
        payout: document.getElementById('payout')?.value ?? '',
        targetProfit: document.getElementById('targetProfit')?.value ?? '',
        accountGain: document.getElementById('accountGain')?.value ?? '',
        manualToggle: document.getElementById('manualToggle')?.checked ?? false,
        manualN: document.getElementById('manualN')?.value ?? '',
        manualK: document.getElementById('manualK')?.value ?? ''
      }
    };
    writeStoredState(state);
  }catch(e){ /* storage unavailable — app still works, just without persistence */ }
}

function loadState(){
  const saved = readStoredState();
  if(!saved) return false;

  try{
    mode = saved.mode || 'simple';
    trades = Array.isArray(saved.trades) ? saved.trades : [];
    balance = saved.balance || 0;
    locked = !!saved.locked;
    sessionCounter = Number.isFinite(saved.sessionCounter) ? saved.sessionCounter : 1;
    sessionHistory = Array.isArray(saved.sessionHistory) ? saved.sessionHistory : [];
    sessionStartTime = saved.sessionStartTime || null;
    streakLoss = saved.streakLoss || 0;
    currentStreakCount = saved.currentStreakCount || 0;
    riskLevel = saved.riskLevel || 'medium';
    capital0 = saved.capital0 || 0;
    payout0 = saved.payout0 || 0;
    target0 = saved.target0 || 0;
    planned0 = saved.planned0 || 0;
    kRequired0 = saved.kRequired0 || 0;
    nRemaining = saved.nRemaining || 0;
    kRemaining = saved.kRemaining || 0;
    tradingPlan = saved.tradingPlan || null;

    const inp = saved.inputs || {};
    if(inp.initialCapital) document.getElementById('initialCapital').value = inp.initialCapital;
    if(inp.payout) document.getElementById('payout').value = inp.payout;
    if(inp.targetProfit) document.getElementById('targetProfit').value = inp.targetProfit;
    if(inp.accountGain) document.getElementById('accountGain').value = inp.accountGain;
    document.getElementById('manualToggle').checked = !!inp.manualToggle;
    if(inp.manualN) document.getElementById('manualN').value = inp.manualN;
    if(inp.manualK) document.getElementById('manualK').value = inp.manualK;

    // restore mode buttons/panels
    document.getElementById('modeBtnSimple').classList.toggle('active', mode === 'simple');
    document.getElementById('modeBtnMasaniello').classList.toggle('active', mode === 'masaniello');
    document.getElementById('panelSimple').classList.toggle('hidden', mode !== 'simple');
    document.getElementById('panelMasaniello').classList.toggle('hidden', mode !== 'masaniello');
    document.getElementById('masaPlanBlock').classList.toggle('hidden', mode !== 'masaniello');
    document.querySelectorAll('.simple-only').forEach(el => el.classList.toggle('hidden', mode !== 'simple'));

    // restore manual-plan panel visibility + risk buttons
    document.getElementById('manualWrap').classList.toggle('show', !!inp.manualToggle);
    document.querySelectorAll('.risklevels button').forEach(b => {
      b.classList.toggle('active', b.dataset.risk === riskLevel);
      b.disabled = !!inp.manualToggle;
    });

    formatCapitalInput();
    return true;
  }catch(e){
    return false;
  }
}

/* =====================================================
   BASIC HELPERS
===================================================== */
function num(id){
  const raw = String(document.getElementById(id).value ?? '').replace(/[$,\s]/g,'');
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}
function intNum(id){
  const v = parseInt(document.getElementById(id).value, 10);
  return Number.isFinite(v) ? v : 0;
}

function formatCapitalInput(){
  const el=document.getElementById('initialCapital');
  const v=num('initialCapital');
  if(v>0) el.value=formatNumber(v);
}
function updateSessionCounter(){
  document.getElementById('sessionCounter').textContent=sessionCounter;
  saveState();
}

function resetSessionCounter(){
  if(!confirm('شمارنده سشن به ۱ بازنشانی شود؟\n\nتاریخچه سشن‌ها و معاملات حذف نخواهد شد.\n\nOK = بازنشانی\nCancel = انصراف')) return;
  sessionCounter = 1;
  updateSessionCounter();
}

function showAbout(){
  const modal = document.getElementById('aboutModal');
  if(!modal) return;
  const version = document.getElementById('aboutVersion');
  if(version) version.textContent = `v${APP_VERSION} • © 2026`;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  document.getElementById('aboutCloseBtn')?.focus();
}

function hideAbout(){
  const modal = document.getElementById('aboutModal');
  if(!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
}

function getCurrency(){
  return 'USD';
}
function getValidPayout(){
  let payout = num('payout');
  if(payout <= 0) payout = 0.01;
  if(payout > 500) payout = 500;
  return payout / 100;
}
function getQuota(){
  return 1 + getValidPayout() * 100 / 100; // 1 + payout%/100, kept explicit for readability
}

/* =====================================================
   MODE SWITCH
===================================================== */
function setMode(m){
  if(m === mode) return;
  if(trades.length > 0){
    alert('برای تغییر حالت، ابتدا یک سشن جدید شروع کنید (سشن فعلی معامله دارد).');
    return;
  }
  mode = m;
  document.getElementById('modeBtnSimple').classList.toggle('active', mode === 'simple');
  document.getElementById('modeBtnMasaniello').classList.toggle('active', mode === 'masaniello');
  document.getElementById('panelSimple').classList.toggle('hidden', mode !== 'simple');
  document.getElementById('panelMasaniello').classList.toggle('hidden', mode !== 'masaniello');
  document.getElementById('masaPlanBlock').classList.toggle('hidden', mode !== 'masaniello');
  document.querySelectorAll('.simple-only').forEach(el => el.classList.toggle('hidden', mode !== 'simple'));
  applySetup();
  resetTradesState();
}

/* =====================================================
   SETUP — recomputes derived plan values; masaniello's
   plan (n,k) is only (re)computed while trades.length===0
===================================================== */
let setupDebounceTimer = null;
function syncTradingPlanStartBalance(){
  const startInput = document.getElementById('tpFormStartBalance');
  if(!startInput || startInput.disabled) return;
  const num = parseFloat(String(document.getElementById('initialCapital').value).replace(/,/g,''));
  if(!isNaN(num)) startInput.value = num;
}

function onSetupChange(){
  syncTradingPlanStartBalance();
  if(trades.length === 0){
    if(mode === 'masaniello'){
      // computePlan searches many (n,k) combinations under extreme
      // inputs (e.g. very low payout + very high target) and can take
      // a couple hundred ms — debounce so typing stays smooth, and show
      // a calculating indicator immediately so the UI doesn't look frozen.
      clearTimeout(setupDebounceTimer);
      setStatus('⏳ در حال محاسبه...', '');
      setupDebounceTimer = setTimeout(() => { applySetup(); render(); }, 150);
      return;
    }
    applySetup();
  }
  render();
}

function onManualToggle(){
  const on = document.getElementById('manualToggle').checked;
  document.getElementById('manualWrap').classList.toggle('show', on);
  document.querySelectorAll('.risklevels button').forEach(b => b.disabled = on);
  if(on && !document.getElementById('manualN').value){
    document.getElementById('manualN').value = planned0 || 10;
    document.getElementById('manualK').value = kRequired0 || 6;
  }
  onSetupChange();
}

function setRisk(level){
  riskLevel = level;
  document.querySelectorAll('.risklevels button').forEach(b=>{
    b.classList.toggle('active', b.dataset.risk === level);
  });
  if(trades.length === 0){
    applySetup();
  }
  render();
}

function applySetup(){
  const initialCapital = num('initialCapital');
  sessionStartTime = new Date().toISOString();

  if(mode === 'simple'){
    balance = initialCapital;
    streakLoss = 0;
    currentStreakCount = 0;
    return;
  }

  // masaniello
  capital0 = initialCapital;
  payout0 = num('payout');
  target0 = num('targetProfit');
  const floor = MIN_STAKE;

  const manualOn = document.getElementById('manualToggle').checked;
  if(manualOn){
    planned0 = Math.max(1, intNum('manualN'));
    kRequired0 = Math.min(planned0, Math.max(1, intNum('manualK')));
  } else {
    const plan = computePlan(riskLevel, capital0, payout0, target0, floor);
    if(plan){
      planned0 = plan.n;
      kRequired0 = plan.k;
    } else {
      planned0 = 0;
      kRequired0 = 0;
    }
  }

  balance = capital0;
  nRemaining = planned0;
  kRemaining = kRequired0;

  const Q = getQuota();
  document.getElementById('breakevenDisplay').textContent = (1/Q*100).toFixed(1) + '%';
}

/* =====================================================
   MASANIELLO ENGINE
   Pure sizing math lives in core/masaniello.js.
===================================================== */
/* =====================================================
   SIMPLE ENGINE (fixed target % + stop loss)
===================================================== */
function getWinProfitAmount(){
  const initialCapital = num('initialCapital');
  const gain = num('accountGain') / 100;
  return initialCapital * gain;
}
function getValidStopLossPct(){
  let pct = num('stopLossPct');
  if(pct <= 0) pct = 0.01;
  if(pct > 100) pct = 100;
  return pct / 100;
}
function getStopLossAmount(){
  return num('initialCapital') * getValidStopLossPct();
}
function getStopLossBalance(){
  return num('initialCapital') - getStopLossAmount();
}
function simpleNextStake(){
  const payout = getValidPayout();
  const targetProfit = getWinProfitAmount();
  return calculateSimpleNextStake({
    payout, targetProfit, streakLoss, floor: MIN_STAKE, balance, stopLossBalance: getStopLossBalance()
  });
}

/* =====================================================
   SHARED NEXT-STAKE DISPATCH
===================================================== */
function getNextStake(){
  if(mode === 'simple') return simpleNextStake();
  const Q = getQuota();
  const floor = MIN_STAKE;
  return masanielloStake(balance, nRemaining, kRemaining, Q, floor, planned0, kRequired0);
}

const LOCK_MESSAGES = {
  'no-trades-left': '⚠ معاملات برنامه‌ریزی‌شده تمام شد — سشن جدید شروع کنید.',
  'target-reached': '✅ هدف قبلاً محقق شده — سشن جدید شروع کنید.',
  'target-impossible': '⚠ رسیدن به هدف با معاملات باقی‌مانده دیگر ممکن نیست.',
  'invalid-payout': '⚠ درصد بازده نامعتبر است.',
  'balance-depleted': '⚠ موجودی تمام شد — سشن جدید شروع کنید.',
  'insufficient-balance': '⚠ موجودی کمتر از حداقل مبلغ معامله است.',
  'stoploss': '⚠ مبلغ معامله لازم برای بازیابی، از بودجه‌ی باقی‌مانده تا حد ضرر بیشتر است — سشن قفل شد.'
};

/* =====================================================
   LOG TRADE
===================================================== */
let lastTradeAt = 0;
function logTrade(result){
  const now = Date.now();
  if(now - lastTradeAt < 350) return; // guard against accidental double-tap/double-fire
  lastTradeAt = now;

  if(locked){
    showAlert(mode === 'simple' ? '⚠ به حد ضرر رسیده‌اید — سشن قفل شده. یک سشن جدید شروع کنید.' : LOCK_MESSAGES['no-trades-left'], 'alert');
    return;
  }

  if(trades.length === 0){
    applySetup();
    if(mode === 'masaniello' && planned0 === 0){
      setStatus('⚠ با این موجودی/بازده/هدف برنامه‌ای وجود ندارد — هدف را کاهش دهید.', 'warn');
      render();
      return;
    }
  }

  const r = getNextStake();
  if(r.reason !== 'ok'){
    locked = true;
    if(mode === 'simple'){
      showAlert(LOCK_MESSAGES[r.reason] || LOCK_MESSAGES['stoploss'], 'alert');
    } else {
      setStatus(LOCK_MESSAGES[r.reason] || '⚠ ادامه معامله ممکن نیست.', 'warn');
    }
    render();
    return;
  }

  applyTradeMath(result, r.stake);
  evaluateLockState();
  render();
}

// Pure state mutation for a single trade outcome. `precomputedStake`, when
// given, skips a redundant getNextStake() call (logTrade() already computed
// it to validate the trade before calling this). The undo-replay below
// omits it on purpose — each replayed step needs a fresh calculation since
// balance/n/k change after every step.
function applyTradeMath(result, precomputedStake){
  const stake = precomputedStake ?? getNextStake().stake;
  let ret;

  if(mode === 'simple'){
    const payout = getValidPayout();
    if(result === 'W'){
      ret = stake * payout;
      balance += ret;
      streakLoss = 0;
      currentStreakCount = 0;
    } else if(result === 'BE'){
      ret = 0;
      // سر به سر: سرمایه و وضعیت ریسک بدون تغییر باقی می‌ماند.
    } else {
      ret = -stake;
      balance += ret;
      streakLoss += stake;
      currentStreakCount++;
    }
  } else {
    const Q = getQuota();
    if(result === 'W'){
      ret = stake * (Q - 1);
      balance += ret;
      kRemaining--;
      nRemaining--;
    } else if(result === 'BE'){
      ret = 0;
      // سر به سر: نه سرمایه تغییر می‌کند نه یکی از معاملات برنامه مصرف می‌شود —
      // چون قیمت جابه‌جا نشده، این معامله عملاً اتفاق نیفتاده است.
    } else {
      ret = -stake;
      balance += ret;
      nRemaining--;
    }
  }

  trades.push({no: trades.length+1, result, amount: stake, ret, balance});
}

function evaluateLockState(){
  if(mode === 'simple'){
    checkStopLoss();
    checkOptionalAlerts();
  } else {
    if(balance <= 0){
      locked = true;
      setStatus('⚠ موجودی تمام شد — سشن جدید شروع کنید.', 'warn');
    } else if(kRemaining <= 0){
      locked = true;
      setStatus('✅ سود هدف محقق شد! می‌توانید سشن جدید شروع کنید.', 'ok');
    } else if(nRemaining <= 0){
      locked = true;
      setStatus('⚠ معاملات برنامه بدون رسیدن به هدف تمام شد.', 'warn');
    } else if(kRemaining > nRemaining){
      locked = true;
      setStatus('⚠ رسیدن به هدف با معاملات باقی‌مانده دیگر ممکن نیست.', 'warn');
    }
  }
}

// Removes only the last logged trade, instead of wiping the whole table.
// Rather than trying to hand-write an inverse of applyTradeMath() for every
// case (risky, especially around locked/edge states), this replays the
// remaining history from the same original starting point — deterministic
// and guaranteed to match whatever applyTradeMath() actually does.
function undoLastTrade(){
  if(trades.length === 0) return;
  const history = trades.slice(0, -1).map(t => t.result);
  const keepStart = sessionStartTime;

  trades = [];
  streakLoss = 0;
  currentStreakCount = 0;
  locked = false;
  clearAlert();

  if(mode === 'simple'){
    balance = num('initialCapital');
  } else {
    balance = capital0;
    nRemaining = planned0;
    kRemaining = kRequired0;
  }
  sessionStartTime = keepStart;

  history.forEach(result => applyTradeMath(result));
  evaluateLockState();
  render();
}

/* =====================================================
   STOP LOSS / ALERTS (simple mode)
===================================================== */
function checkStopLoss(){
  const stopLossBalance = getStopLossBalance();

  if(balance <= stopLossBalance){
    locked = true;
    showAlert('⚠ به حد ضرر (Stop Loss) رسیدید — معامله در این سشن قفل شد.', 'alert');
    return;
  }

  const totalRisk = getStopLossAmount();
  const remaining = balance - stopLossBalance;
  const used = totalRisk - remaining;
  const usedPct = totalRisk > 0 ? (used / totalRisk * 100) : 0;

  let alertPct = num('stopLossAlertPct');
  if(alertPct <= 0 || alertPct > 100) alertPct = 80;

  if(usedPct >= alertPct){
    showAlert('⚠ هشدار: به محدوده‌ی حد ضرر نزدیک شده‌اید.', 'warning');
  } else {
    clearAlert();
  }
}

function checkOptionalAlerts(){
  if(document.getElementById('t-sessionEnd')?.textContent === 'ON'){
    const winProfit = getWinProfitAmount();
    const pl = balance - num('initialCapital');
    if(winProfit > 0 && pl >= winProfit){
      showAlert('✅ هدف سود این سشن محقق شد — پیشنهاد می‌شود سشن را ببندید.', 'info');
    }
  }
  if(document.getElementById('t-lowTrade')?.textContent === 'ON'){
    const maxLoss = parseInt(document.getElementById('maxLossLimit').textContent, 10) || 0;
    const remainingBudget = maxLoss - currentStreakCount;
    if(maxLoss > 0 && remainingBudget <= 2 && remainingBudget >= 0 && !locked){
      showAlert('⚠ فقط ' + remainingBudget + ' باخت متوالی دیگر تا رسیدن به حد ضرر باقی مانده.', 'warning');
    }
  }
}

function showAlert(message, type){
  document.getElementById('alertBox').innerHTML = `<div class="${type}">${message}</div>`;
}
function clearAlert(){
  document.getElementById('alertBox').innerHTML = '';
}
function setStatus(text, cls){
  const map = { ok:'success', warn:'warning', '':'status' };
  const type = map[cls] ?? 'status';
  document.getElementById('alertBox').innerHTML = text ? `<div class="${type}">${text}</div>` : '';
}

/* =====================================================
   CLEAR / NEW SESSION
===================================================== */
// Raw reset — no confirmation, no history save. Used internally by
// setMode() (only ever called when trades.length===0) and by
// newSession() (which already confirmed + saved before calling this).
function resetTradesState(){
  trades = [];
  streakLoss = 0;
  currentStreakCount = 0;
  locked = false;
  clearAlert();
  applySetup();
  if(mode === 'masaniello'){
    setStatus(planned0 ? 'آماده شروع' : '⚠ با این موجودی/بازده/هدف برنامه‌ای وجود ندارد.', planned0 ? '' : 'warn');
  }
  render();
}

// Bound to the "پاک کردن جدول" button. Unlike newSession(), a click
// here has no other confirmation step before it, so this one confirms
// and saves the current session to history itself before wiping it —
// otherwise a single misclick would silently destroy the whole table.
function clearTrades(){
  if(trades.length > 0){
    if(!confirm('جدول معاملات جاری پاک شود؟\n\nOK = ثبت سشن در تاریخچه و پاک کردن\nCancel = انصراف')) return;
    saveSession();
  }
  resetTradesState();
}

function newSession(){
  if(trades.length > 0){
    const choice = confirm('سشن فعلی ثبت شود و سشن جدید شروع شود؟\n\nOK = ثبت و شروع سشن جدید\nCancel = انصراف');
    if(!choice) return;
    saveSession();
  }

  if(document.getElementById('t-autoCopy')?.textContent === 'ON' && trades.length > 0){
    document.getElementById('initialCapital').value = formatNumber(balance);
  }

  sessionCounter++;
  updateSessionCounter();
  resetTradesState();
}


/* =====================================================
   SESSION HISTORY
===================================================== */
function saveSession(){
  if(trades.length === 0) return;

  const initial = trades[0].balance - trades[0].ret;
  const finalBalance = balance;

  sessionHistory.push({
    session: sessionHistory.length + 1,
    mode,
    trades: trades.length,
    wins: trades.filter(t => t.result === 'W').length,
    losses: trades.filter(t => t.result === 'L').length,
    breakevens: trades.filter(t => t.result === 'BE').length,
    initial,
    finalBalance,
    profit: finalBalance - initial,
    date: formatDateTime(new Date()),
    endedAt: new Date().toISOString()
  });

  renderHistory();
}

// Pure helper: returns sessionHistory enriched with a running CUMULATIVE
// win-rate (wins/trades %, same convention as the live W:/L:/WR: summary
// shown during a session) and a trend ('up'/'down'/'flat') comparing each
// session's cumulative rate to the previous session's. Does not mutate
// sessionHistory — reused as-is by renderHistory(), exportHistoryCSV(),
// and generateLog() so this calculation exists in exactly one place.
function computeHistoryWithCumulativeStats(){
  return computeHistoryWithCumulativeStatsPure(sessionHistory);
}

function renderHistory(){
  const wrap = document.getElementById('historyWrap');
  if(sessionHistory.length === 0){
    wrap.innerHTML = '<div class="small" style="text-align:center; padding:10px;">هنوز سشنی ثبت نشده</div>';
    saveState();
    return;
  }
  const enriched = computeHistoryWithCumulativeStats();
  const trendIcon = { up: '▲', down: '▼', flat: '–' };
  const trendClass = { up: 'trend-up', down: 'trend-down', flat: '' };
  wrap.innerHTML = enriched.slice().reverse().map(s => `
    <div class="histrow-wrap">
      <div class="histrow">
        <span>#${s.session} · ${s.mode === 'simple' ? 'Simple' : 'Masaniello'} · ${s.trades} معامله (${s.wins}W/${s.breakevens || 0}BE/${s.losses}L)</span>
        <span class="hp ${s.profit < 0 ? 'neg' : 'pos'}">${money(s.profit)}</span>
      </div>
      <div class="histrow-sub">
        <span>برد تجمعی: ${s.cumulativeWinRate.toFixed(1)}%</span>
        <span class="${trendClass[s.trend]}">${trendIcon[s.trend]}</span>
      </div>
    </div>
  `).join('');

  saveState();
}

function clearHistory(){
  if(sessionHistory.length === 0) return;
  if(!confirm('تاریخچه‌ی همه‌ی سشن‌ها پاک شود؟')) return;
  sessionHistory = [];
  renderHistory();
}

async function exportHistoryCSV(){
  if(sessionHistory.length === 0){
    alert('تاریخچه‌ای برای خروجی گرفتن وجود ندارد.');
    return;
  }
  const csv = buildHistoryCSV(sessionHistory);
  const filename = "TM.re3a.csv";
  if(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()){
    try{
      const { Filesystem, Share } = window.Capacitor.Plugins;
      await Filesystem.writeFile({ path: filename, data: csv, directory: 'CACHE', encoding: 'utf8' });
      const { uri } = await Filesystem.getUri({ directory: 'CACHE', path: filename });
      await Share.share({ title: 'Session History CSV', url: uri });
    }catch(e){
      alert('خروجی گرفتن با خطا مواجه شد: ' + (e && e.message ? e.message : e));
    }
    return;
  }
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* =====================================================
   TRADING PLAN — independent long-term planning layer
   (see Trading Plan architecture doc, Revision 3 — FROZEN)

   Isolation contract:
   - Reads sessionHistory and the live `balance` only.
   - Never reads or writes anything belonging to Simple Mode,
     Masaniello, recovery, or stake calculations.
   - computeTradingPlanStats() is pure: no DOM access, no
     saveState()/render() calls, no mutation of any kind.
===================================================== */
// Pure trading-plan helpers live in core/trading-plan.js.
function computeTradingPlanStats(){
  return computeTradingPlanStatsPure(tradingPlan, sessionHistory, balance);
}

/* renderTradingPlan() — display only (Phase 4).
   Calls computeTradingPlanStats() exactly once and reuses the
   returned object for every displayed value. No calculation is
   duplicated here. No event handlers, no saveState(), no automatic
   status changes. */
function renderTradingPlan(){
  const createView = document.getElementById('tradingPlanCreateView');
  const activeView = document.getElementById('tradingPlanActiveView');
  const reachedView = document.getElementById('tradingPlanTargetReached');
  if(!createView || !activeView || !reachedView) return;

  const isRunning = !!tradingPlan && tradingPlan.status === 'running';

  createView.classList.toggle('hidden', isRunning);
  activeView.classList.toggle('hidden', !isRunning);

  if(!isRunning){
    reachedView.classList.add('hidden');
    return;
  }

  document.getElementById('tpPlanName').textContent = tradingPlan.planName || '-';
  document.getElementById('tpStartBalance').textContent = money(tradingPlan.planStartBalance);
  document.getElementById('tpTargetPercent').textContent =
    Number.isFinite(tradingPlan.targetPercent) ? tradingPlan.targetPercent.toFixed(2) + '%' : '-';
  document.getElementById('tpTargetBalance').textContent = money(tradingPlan.targetBalance);

  const stats = computeTradingPlanStats();

  document.getElementById('tpRemainingProfit').textContent =
    Number.isFinite(stats.remainingProfit) ? money(stats.remainingProfit) : '-';
  document.getElementById('tpProgressPercent').textContent =
    Number.isFinite(stats.progressPercent) ? stats.progressPercent.toFixed(2) + '%' : '-';
  document.getElementById('tpSessionsCompleted').textContent = stats.sessionsCompletedTowardPlan;
  document.getElementById('tpAvgProfitPerSession').textContent =
    stats.averageProfitPerCompletedSession !== null ? money(stats.averageProfitPerCompletedSession) : '-';
  document.getElementById('tpEstSessionsRemaining').textContent =
    stats.estimatedSessionsRemaining !== null ? Math.ceil(stats.estimatedSessionsRemaining) : '-';
  document.getElementById('tpRequiredAvgProfit').textContent =
    stats.requiredAverageProfitPerSession !== null ? money(stats.requiredAverageProfitPerSession) : '-';

  reachedView.classList.toggle('hidden', !stats.targetReached);
}

/* ---- Trading Plan action handlers (Phase 5) ----
   One shared form (#tradingPlanCreateView) is used for both
   creating a new plan and editing the current one.
   These handlers only orchestrate existing Trading Plan
   functions (createTradingPlan/updateTradingPlan/
   completeTradingPlan/cancelTradingPlan) — no business logic
   is duplicated here. */

// Transient UI-only state: which action the shared form currently represents.
// Not part of tradingPlan, never persisted, never read by any calculation.
let tradingPlanFormMode = 'create';

// UI-only housekeeping: clears the shared form's fields and resets it to
// its default "create" appearance. Not a calculation.
function clearTradingPlanForm(){
  tradingPlanFormMode = 'create';
  document.getElementById('tpFormName').value = '';
  document.getElementById('tpFormStartBalance').value = '';
  document.getElementById('tpFormStartBalance').disabled = false;
  document.getElementById('tpFormTargetPercent').value = '';
  document.getElementById('tpFormTargetBalance').value = '';
  document.querySelector('input[name="tpTargetType"][value="percent"]').checked = true;
  onTradingPlanTargetTypeChange();
}

// Shows only the target input matching the selected Target Type radio —
// the other target field is never visible at the same time, for either
// Create or Edit. Pure UI toggle, not a calculation.
function onTradingPlanTargetTypeChange(){
  const isPercent = document.querySelector('input[name="tpTargetType"]:checked').value === 'percent';
  document.getElementById('tpFormTargetPercentRow').classList.toggle('hidden', !isPercent);
  document.getElementById('tpFormTargetBalanceRow').classList.toggle('hidden', isPercent);
  document.getElementById('tpTypeLabelPercent').classList.toggle('active', isPercent);
  document.getElementById('tpTypeLabelBalance').classList.toggle('active', !isPercent);
}

// The Create/Save button: reads inputs, then calls exactly one of
// createTradingPlan() (new plan) or updateTradingPlan() (same plan,
// identity preserved), then calls render(). Which one depends only on
// tradingPlanFormMode, set by onTradingPlanEdit()/clearTradingPlanForm().
function onTradingPlanFormSubmit(){
  const planName = document.getElementById('tpFormName').value;
  const isPercent = document.querySelector('input[name="tpTargetType"]:checked').value === 'percent';
  const targetPercent = isPercent ? parseFloat(document.getElementById('tpFormTargetPercent').value) : NaN;
  const targetBalance = !isPercent ? parseFloat(document.getElementById('tpFormTargetBalance').value) : NaN;

  // Guard: the visible target field must contain a real number. Without
  // this, an empty active field silently resolves to targetPercent/
  // targetBalance both null (resolvePlanTarget's correct response to
  // "nothing was provided"), which callers here never expected to persist.
  const activeTargetValid = isPercent ? Number.isFinite(targetPercent) : Number.isFinite(targetBalance);
  if(!activeTargetValid) return;

  if(tradingPlanFormMode === 'edit'){
    updateTradingPlan(planName, targetPercent, targetBalance);
  } else {
    const planStartBalance = parseFloat(document.getElementById('tpFormStartBalance').value);
    if(!Number.isFinite(planStartBalance)) return;
    createTradingPlan(planName, planStartBalance, targetPercent, targetBalance);
  }

  render();
  clearTradingPlanForm();
}

// Reveals the shared form pre-filled with the current plan's values, in
// "edit" mode: planStartBalance is shown but disabled (edit must never
// change it), and only one target field is shown at a time via the
// Target Type selector, defaulting to Percentage. Does not call
// updateTradingPlan()/render() — that only happens on submit.
function onTradingPlanEdit(){
  if(!tradingPlan) return;
  tradingPlanFormMode = 'edit';

  document.getElementById('tpFormName').value = tradingPlan.planName || '';

  document.getElementById('tpFormStartBalance').value = tradingPlan.planStartBalance;
  document.getElementById('tpFormStartBalance').disabled = true;

  document.querySelector('input[name="tpTargetType"][value="percent"]').checked = true;
  document.getElementById('tpFormTargetPercent').value =
    Number.isFinite(tradingPlan.targetPercent) ? tradingPlan.targetPercent : '';
  document.getElementById('tpFormTargetBalance').value = '';
  onTradingPlanTargetTypeChange();

  document.getElementById('tradingPlanCreateView').classList.remove('hidden');
  document.getElementById('tradingPlanActiveView').classList.add('hidden');
}

function onTradingPlanComplete(){
  if(!confirm('برنامه به عنوان تکمیل‌شده علامت‌گذاری شود؟\n\nOK = تکمیل برنامه\nCancel = انصراف')) return;
  completeTradingPlan();
  render();
  clearTradingPlanForm();
}

function onTradingPlanCancel(){
  if(!confirm('این برنامه لغو شود؟\n\nOK = لغو برنامه\nCancel = انصراف')) return;
  cancelTradingPlan();
  render();
  clearTradingPlanForm();
}

function copyNextStake(){
  const r = !locked ? getNextStake() : {stake:0, reason:'locked'};
  if(locked || r.reason !== 'ok'){
    alert('مبلغ معامله بعدی در حال حاضر موجود نیست.');
    return;
  }
  const text = r.stake.toFixed(2);
  const btn = document.getElementById('copyStakeBtn');
  const done = () => {
    if(btn){
      const original = 'کپی';
      btn.textContent = 'کپی شد ✓';
      setTimeout(() => { btn.textContent = original; }, 1200);
    }
  };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(done).catch(() => alert('مبلغ: ' + text));
  } else {
    alert('مبلغ: ' + text);
  }
}

/* =====================================================
   SESSION LOG (JSON) — for AI / human risk-reward review
===================================================== */
function computeSessionMetricsGeneric(){
  const initialCapital = num('initialCapital');
  const wins = trades.filter(t => t.result === 'W').length;
  const losses = trades.length - wins;
  const totalStaked = trades.reduce((a,t)=>a+t.amount,0);
  const netPL = balance - initialCapital;

  let peak = initialCapital, maxDDDollar = 0;
  const path = [initialCapital, ...trades.map(t=>t.balance)];
  path.forEach(b=>{
    if(b>peak) peak = b;
    const dd = peak - b;
    if(dd > maxDDDollar) maxDDDollar = dd;
  });

  const base = {
    mode,
    start_balance: initialCapital,
    final_balance: Math.round(balance*100)/100,
    net_profit_loss: Math.round(netPL*100)/100,
    total_trades_taken: trades.length,
    wins, losses,
    actual_win_rate_percent: trades.length ? Math.round((wins/trades.length*100)*100)/100 : null,
    total_amount_staked: Math.round(totalStaked*100)/100,
    max_drawdown_dollar: Math.round(maxDDDollar*100)/100,
    max_drawdown_percent: peak>0 ? Math.round((maxDDDollar/peak*100)*100)/100 : 0,
    locked
  };

  if(mode === 'masaniello'){
    const Q = getQuota();
    const targetBalance = capital0 + target0;
    const guaranteedWorstCase = guaranteedWorstCaseFinal(capital0, planned0, kRequired0, Q);
    return Object.assign(base, {
      instrument_payout_percent: payout0,
      decimal_odds_Q: Math.round(Q*10000)/10000,
      break_even_win_rate_percent: Math.round((1/Q*100)*100)/100,
      plan: {
        planned_trades_n: planned0,
        wins_required_k: kRequired0,
        losses_allowed_budget: planned0 - kRequired0,
        losses_used: losses,
        losses_budget_remaining: (planned0 - kRequired0) - losses
      },
      target_profit: target0,
      target_balance: Math.round(targetBalance*100)/100,
      guaranteed_worst_case_final_balance: guaranteedWorstCase!==null ? Math.round(guaranteedWorstCase*100)/100 : null,
      target_achieved: balance >= targetBalance
    });
  }

  return Object.assign(base, {
    payout_percent: num('payout'),
    account_gain_target_percent: num('accountGain'),
    stop_loss_percent: num('stopLossPct'),
    stop_loss_balance_floor: Math.round(getStopLossBalance()*100)/100
  });
}

function toggleLog(){
  const wrap = document.getElementById('logWrap');
  const show = !wrap.classList.contains('show');
  wrap.classList.toggle('show', show);
  if(show) generateLog();
}

function generateLog(){
  const liveMetrics = trades.length > 0 ? computeSessionMetricsGeneric() : null;

  const log = {
    generated_at: new Date().toISOString(),
    tool: `Trade Manager v${APP_VERSION} (Simple + Masaniello)`,
    currency: getCurrency(),
    current_session: liveMetrics,
    session_history: computeHistoryWithCumulativeStats()
  };

  document.getElementById('logOutput').value = JSON.stringify(log, null, 2);
  document.getElementById('copyBtn').textContent = 'کپی';
  document.getElementById('copyBtn').classList.remove('copied');
}

function copyLog(){
  const ta = document.getElementById('logOutput');
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);

  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(ta.value).then(markCopied).catch(() => fallbackCopy(ta));
    return;
  }
  fallbackCopy(ta);
}
function fallbackCopy(ta){
  try{
    const ok = document.execCommand('copy');
    if(ok) markCopied();
  }catch(e){ /* selection remains for manual copy */ }
}
function markCopied(){
  const btn = document.getElementById('copyBtn');
  btn.textContent = 'کپی شد ✓';
  btn.classList.add('copied');
}

/* =====================================================
   UI TOGGLES
===================================================== */
function toggleBtn(id){
  const el = document.getElementById(id);
  const isOn = !el.classList.contains('off');
  if(isOn){
    el.classList.add('off');
    el.textContent = 'OFF';
  } else {
    el.classList.remove('off');
    el.textContent = 'ON';
  }
  if(id === 't-sessionEnd' || id === 't-lowTrade'){
    checkOptionalAlerts();
  }
}

/* =====================================================
   RENDER
===================================================== */
function render(){
  const tbody = document.getElementById('tbody');

  if(trades.length === 0){
    tbody.innerHTML = '<tr class="emptyrow"><td colspan="5">هنوز معامله‌ای ثبت نشده — یک نتیجه را ثبت کنید</td></tr>';
  } else {
    tbody.innerHTML = trades.map(t => `
      <tr class="${t.result === 'W' ? 'rowW' : (t.result === 'BE' ? 'rowBE' : 'rowL')}">
        <td>${t.no}</td>
        <td><span class="badge ${t.result}">${t.result}</span></td>
        <td>${money(t.amount)}</td>
        <td class="${t.ret < 0 ? 'neg' : 'pos'}">${money(t.ret)}</td>
        <td>${money(t.balance)}</td>
      </tr>
    `).join('');
  }

  const wins = trades.filter(t => t.result === 'W').length;
  const breakevens = trades.filter(t => t.result === 'BE').length;
  const losses = trades.filter(t => t.result === 'L').length;

  document.getElementById('winBtn').disabled = locked;
  document.getElementById('beBtn').disabled = locked;
  document.getElementById('lossBtn').disabled = locked;

  // shared session performance summary (balance / P&L / W-L-T-WR abbreviated)
  const winRate = trades.length ? Math.round(wins / trades.length * 100) : 0;
  const initialForPL = mode === 'simple' ? num('initialCapital') : capital0;
  const pl = balance - initialForPL;

  document.getElementById('curBalance').textContent = money(balance);
  document.getElementById('titlebarBalance').textContent = money(balance);
  const curPLEl = document.getElementById('curPL');
  curPLEl.textContent = money(pl);
  curPLEl.className = pl < 0 ? 'neg' : 'pos';

  let wlText = `W:${wins} BE:${breakevens} L:${losses} T:${trades.length} WR:${winRate}%`;
  if(mode === 'simple' && currentStreakCount > 0){
    wlText += ` STK:${currentStreakCount}`;
  }
  document.getElementById('wlSummary').textContent = wlText;

  renderTradingPlan();

  const nextStakeResult = !locked ? getNextStake() : {stake:0, reason:'locked'};

  if(mode === 'simple'){
    recalc();
  } else {
    document.getElementById('planN').textContent = planned0 || '-';
    document.getElementById('planK').textContent = kRequired0 || '-';
    document.getElementById('planBuffer').textContent = planned0 ? (planned0 - kRequired0) : '-';

    const guaranteeEl = document.getElementById('guaranteeLine');
    if(planned0 > 0){
      const Q = getQuota();
      const wc = guaranteedWorstCaseFinal(capital0, planned0, kRequired0, Q);
      const targetBalance = capital0 + target0;
      if(wc !== null){
        const safe = wc >= targetBalance - 0.005;
        guaranteeEl.className = 'guaranteeline' + (safe ? '' : ' bad');
        guaranteeEl.innerHTML = (safe ? 'نتیجه تضمینی این برنامه: ' : 'هشدار — نتیجه‌ی این برنامه کمتر از هدف است: ')
          + '<b>' + money(wc) + '</b>' + (safe ? ' — صرف‌نظر از اینکه کدام معاملات برنده/بازنده باشند (تا سقف باخت مجاز).' : ' — هدف ' + money(targetBalance) + ' بود.');
      } else {
        guaranteeEl.textContent = '-';
      }
    } else {
      guaranteeEl.textContent = '-';
    }

    if(!locked && nextStakeResult.reason === 'ok'){
      setStatus(trades.length === 0 ? 'آماده شروع' : `${trades.length} معامله ثبت شده — ${nRemaining} باقی‌مانده`, '');
    }
  }

  document.getElementById('nextStakePreview').textContent =
    (locked || nextStakeResult.reason !== 'ok') ? '— قفل —' : money(nextStakeResult.stake);

  saveState();
}

/* =====================================================
   CALCULATIONS (simple mode)
===================================================== */
function recalc(){
  const initialCapital = num('initialCapital');
  const gainPct = num('accountGain') / 100;
  const capitalFinal = initialCapital * (1 + gainPct);
  const winProfit = getWinProfitAmount();
  const stopLossAmount = getStopLossAmount();
  const stopLossBalance = getStopLossBalance();

  document.getElementById('capitalFinal').textContent = money(capitalFinal);
  document.getElementById('winProfit').textContent = money(winProfit);
  document.getElementById('stopLossAmt').textContent = money(stopLossBalance);

  const payout = getValidPayout();
  let cumulativeLoss = 0;
  let count = 0;
  let firstStake = null;
  for(let i = 0; i < 500; i++){
    const stake = (cumulativeLoss + winProfit) / payout;
    if(i === 0) firstStake = stake;
    if(cumulativeLoss + stake > stopLossAmount) break;
    cumulativeLoss += stake;
    count++;
  }
  document.getElementById('maxLossLimit').textContent = count;

  const explainEl = document.getElementById('lossLimitExplain');
  if(count === 0 && firstStake !== null){
    explainEl.innerHTML = `معامله ۱ نیاز به ${money(firstStake)} دارد<br>بودجه‌ی مجاز حد ضرر: ${money(stopLossAmount)}<br>با این هدف، بازیابی حتی از یک باخت هم ممکن نیست — هدف سشن را کاهش دهید یا حد ضرر را افزایش دهید.`;
    explainEl.style.display = '';
  } else {
    explainEl.innerHTML = '';
    explainEl.style.display = 'none';
  }
}


function bindUI(){
  const $ = id => document.getElementById(id);
  $('modeBtnSimple')?.addEventListener('click', () => setMode('simple'));
  $('modeBtnMasaniello')?.addEventListener('click', () => setMode('masaniello'));
  $('stopLossAlertPct')?.addEventListener('input', render);
  $('t-sessionEnd')?.addEventListener('click', () => toggleBtn('t-sessionEnd'));
  $('t-lowTrade')?.addEventListener('click', () => toggleBtn('t-lowTrade'));
  $('t-autoCopy')?.addEventListener('click', () => toggleBtn('t-autoCopy'));
  document.querySelector('.optionpanel .btn-secondary.btn-sm')?.addEventListener('click', resetSessionCounter);
  $('aboutBtn')?.addEventListener('click', showAbout);
  $('aboutCloseBtn')?.addEventListener('click', hideAbout);
  $('aboutOkBtn')?.addEventListener('click', hideAbout);
  $('aboutModal')?.addEventListener('click', event => {
    if(event.target === event.currentTarget) hideAbout();
  });
  document.addEventListener('keydown', event => {
    if(event.key === 'Escape') hideAbout();
  });

  $('winBtn')?.addEventListener('click', () => logTrade('W'));
  $('beBtn')?.addEventListener('click', () => logTrade('BE'));
  $('lossBtn')?.addEventListener('click', () => logTrade('L'));
  $('clearBtn')?.addEventListener('click', clearTrades);
  $('undoBtn')?.addEventListener('click', undoLastTrade);
  $('copyStakeBtn')?.addEventListener('click', copyNextStake);

  $('initialCapital')?.addEventListener('input', onSetupChange);
  $('initialCapital')?.addEventListener('blur', formatCapitalInput);
  ['payout','accountGain','stopLossPct','targetProfit','manualN','manualK'].forEach(id => $(id)?.addEventListener('input', onSetupChange));
  $('manualToggle')?.addEventListener('change', onManualToggle);
  document.querySelectorAll('.risklevels button').forEach(button => button.addEventListener('click', () => setRisk(button.dataset.risk)));

  document.querySelectorAll('input[name="tpTargetType"]').forEach(input => input.addEventListener('change', onTradingPlanTargetTypeChange));
  const planCreateButton = $('tradingPlanCreateView')?.querySelector('.subactions .btn');
  planCreateButton?.addEventListener('click', onTradingPlanFormSubmit);
  const activeButtons = $('tradingPlanActiveView')?.querySelectorAll('.subactions .btn') || [];
  activeButtons[0]?.addEventListener('click', onTradingPlanEdit);
  activeButtons[1]?.addEventListener('click', onTradingPlanComplete);
  activeButtons[2]?.addEventListener('click', onTradingPlanCancel);

  const histButtons = document.querySelectorAll('.histbtns button');
  histButtons[0]?.addEventListener('click', exportHistoryCSV);
  histButtons[1]?.addEventListener('click', clearHistory);
  document.querySelector('.logbtn')?.addEventListener('click', toggleLog);
  $('copyBtn')?.addEventListener('click', copyLog);
}

/* =====================================================
   INITIALIZATION
===================================================== */

bindUI();

const restored = loadState();
if(!restored){
  document.getElementById('modeBtnSimple').classList.add('active');
  document.querySelector('.risklevels button[data-risk="medium"]').classList.add('active');
  formatCapitalInput();
  applySetup();
}
render();
renderHistory();
updateSessionCounter();

/* Session pill: tap = new session, long-press = reset session counter (shortcut for the Settings option) */
(function(){
  const pill = document.getElementById('sessionPill');
  if(!pill) return;
  const LONG_MS = 3000;
  const TAP_MS = 250;
  let timer = null, longFired = false, downAt = 0;
  function down(){
    longFired = false;
    downAt = Date.now();
    timer = setTimeout(() => { longFired = true; timer = null; resetSessionCounter(); }, LONG_MS);
  }
  function up(){
    if(timer){ clearTimeout(timer); timer = null; }
    if(!longFired && (Date.now() - downAt) <= TAP_MS) newSession();
  }
  function cancel(){
    if(timer){ clearTimeout(timer); timer = null; }
  }
  pill.addEventListener('pointerdown', down);
  pill.addEventListener('pointerup', up);
  pill.addEventListener('pointerleave', cancel);
  pill.addEventListener('pointercancel', cancel);
})();

/* Android hardware/gesture back button: don't exit on a single press —
   show a toast and only exit if back is pressed again within 2 seconds.
   Native-only; does nothing in a plain browser. */
if(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()){
  const { App, Toast } = window.Capacitor.Plugins;
  let lastBackPressAt = 0;
  const EXIT_WINDOW_MS = 2000;
  App.addListener('backButton', () => {
    const now = Date.now();
    if(now - lastBackPressAt <= EXIT_WINDOW_MS){
      App.exitApp();
      return;
    }
    lastBackPressAt = now;
    Toast.show({ text: 'برای خروج، دوباره دکمه Back را بزنید', duration: 'short' });
  });
}

