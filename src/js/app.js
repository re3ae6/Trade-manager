import { formatNumber, money, formatDateTime } from './core/format.js';
import { computePlan, guaranteedWorstCaseFinal, masanielloStake } from './core/masaniello.js';
import { calculateSimpleNextStake } from './core/simple.js';
import { generatePlanId, resolvePlanTarget, computeTradingPlanStats as computeTradingPlanStatsPure, computeTradingPlanRiskOptions } from './core/trading-plan.js';
import { computeHistoryWithCumulativeStats as computeHistoryWithCumulativeStatsPure, buildHistoryCSV } from './core/history.js';
import { readStoredState, writeStoredState } from './storage/state.js';
import { computePerformanceStats } from './core/analytics.js';
import { buildMasanielloPlans, buildSimplePlans, validateMasanielloCustom } from './core/planner.js';
import { applyTradeOutcome } from './core/session.js';

/* =====================================================
   STATE (shared between both modes — only one mode's
   engine runs at a time, so trades/balance/locked are shared)
===================================================== */
const MIN_STAKE = 1; // Pocket Option rule: minimum $1 per trade — not user-editable
const APP_VERSION = '2.4.0';

let mode = 'simple';               // 'simple' | 'masaniello'
let trades = [];                   // {no, result, amount, ret, balance}
let balance = 0;
let locked = false;
let lockReason = null; // target | stoploss | balance | plan-complete | plan-impossible
let selectedPlannerRisk = null;
let selectedPlannerPlan = null;
let sessionPaused = false;

let sessionCounter = 1;
let sessionHistory = [];           // {session, mode, trades, wins, losses, initial, finalBalance, profit, date, endedAt}
let sessionStartTime = null;
let sessionEndDialogOpen = false;

// Trading Plan — independent long-term planning layer (see Trading Plan architecture doc).
// Never read by, or written from, Simple Mode / Masaniello / recovery / stake logic.
let tradingPlan = null;

// simple-mode-only runtime state
let streakLoss = 0;
let currentStreakCount = 0;
let simplePlanN = 0, simplePlanK = 0;

// masaniello-mode-only runtime state
let riskLevel = 'medium';
let capital0 = 0, payout0 = 0, target0 = 0;
let planned0 = 0, kRequired0 = 0;
let nRemaining = 0, kRemaining = 0;

/* =====================================================
   PERSISTENCE — auto-save/restore across refresh & tab
   close. Everything lives in localStorage. Storage failures
   are logged and do not crash the app; the app can continue
   operating without persistence.
===================================================== */

function getPersistableState(){
  return {
    version: 2,
    mode, trades, balance, locked, sessionCounter, sessionHistory, sessionStartTime, sessionPaused,
    streakLoss, currentStreakCount, simplePlanN, simplePlanK,
    riskLevel, capital0, payout0, target0, planned0, kRequired0, nRemaining, kRemaining,
    tradingPlan, selectedPlannerRisk, selectedPlannerPlan,
    inputs: {
      initialCapital: document.getElementById('initialCapital')?.value ?? '',
      payout: document.getElementById('payout')?.value ?? '',
      mainTargetType: document.querySelector('input[name="mainTargetType"]:checked')?.value ?? 'percent',
      mainTargetValue: document.getElementById('mainTargetValue')?.value ?? '',
      stopLossPct: document.getElementById('stopLossPct')?.value ?? '',
      stopLossAlertPct: document.getElementById('stopLossAlertPct')?.value ?? '',
      manualToggle: document.getElementById('manualToggle')?.checked ?? false,
      manualN: document.getElementById('manualN')?.value ?? '',
      manualK: document.getElementById('manualK')?.value ?? ''
    }
  };
}

function saveState(){
  writeStoredState(getPersistableState());
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
    sessionPaused = !!saved.sessionPaused;
    selectedPlannerRisk = saved.selectedPlannerRisk || null;
    selectedPlannerPlan = saved.selectedPlannerPlan || null;
    streakLoss = saved.streakLoss || 0;
    currentStreakCount = saved.currentStreakCount || 0;
    simplePlanN = saved.simplePlanN || 0;
    simplePlanK = saved.simplePlanK || 0;
    riskLevel = saved.riskLevel || 'medium';
    capital0 = saved.capital0 || 0;
    payout0 = saved.payout0 || 0;
    target0 = saved.target0 || 0;
    planned0 = saved.planned0 || 0;
    kRequired0 = saved.kRequired0 || 0;
    nRemaining = saved.nRemaining || 0;
    kRemaining = saved.kRemaining || 0;
    tradingPlan = saved.tradingPlan || null;
    if(tradingPlan && tradingPlan.status === 'running' && !Array.isArray(tradingPlan.riskOptions)){
      tradingPlan.payoutPercent = Number.isFinite(tradingPlan.payoutPercent) ? tradingPlan.payoutPercent : num('payout');
      tradingPlan.riskOptions = computeTradingPlanRiskOptions(
        tradingPlan.planStartBalance,
        tradingPlan.targetBalance,
        tradingPlan.payoutPercent
      );
    }

    const inp = saved.inputs || {};
    if(inp.initialCapital) document.getElementById('initialCapital').value = inp.initialCapital;
    if(inp.payout) document.getElementById('payout').value = inp.payout;
    if(inp.stopLossPct) document.getElementById('stopLossPct').value = inp.stopLossPct;
    if(inp.stopLossAlertPct) document.getElementById('stopLossAlertPct').value = inp.stopLossAlertPct;
    document.getElementById('manualToggle').checked = !!inp.manualToggle;
    if(inp.manualN) document.getElementById('manualN').value = inp.manualN;
    if(inp.manualK) document.getElementById('manualK').value = inp.manualK;
    if(inp.mainTargetValue) document.getElementById('mainTargetValue').value = inp.mainTargetValue;
    if(inp.mainTargetType){ const radio=document.querySelector(`input[name="mainTargetType"][value="${inp.mainTargetType}"]`); if(radio) radio.checked=true; }

    // restore mode buttons/panels
    document.getElementById('modeBtnSimple').classList.toggle('active', mode === 'simple');
    document.getElementById('modeBtnMasaniello').classList.toggle('active', mode === 'masaniello');
    document.getElementById('panelSimple').classList.toggle('hidden', mode !== 'simple');
    document.getElementById('panelMasaniello').classList.toggle('hidden', mode !== 'masaniello');
    document.getElementById('masaPlanBlock').classList.toggle('hidden', mode !== 'masaniello');
  document.getElementById('simplePlannerBlock')?.classList.toggle('hidden', mode !== 'simple');
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
  const el = document.getElementById(id);
  if(!el) return 0;
  const raw = String(el.value ?? '').replace(/[$,\s]/g,'');
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

function getDialogEls(){
  return {
    modal: document.getElementById('appDialog'),
    title: document.getElementById('appDialogTitle'),
    message: document.getElementById('appDialogMessage'),
    cancel: document.getElementById('appDialogCancel'),
    alt: document.getElementById('appDialogAlt'),
    ok: document.getElementById('appDialogOk')
  };
}

function closeDialog(){
  const {modal, cancel, alt, ok} = getDialogEls();
  if(!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden','true');
  cancel?.classList.add('hidden');
  alt?.classList.add('hidden');
  ok?.classList.remove('hidden');
}

function showAppMessage(message, title='پیام'){
  return new Promise(resolve => {
    const {modal, title: titleEl, message: messageEl, cancel, alt, ok} = getDialogEls();
    if(!modal) return resolve();
    titleEl.textContent = title;
    messageEl.textContent = message;
    cancel.classList.add('hidden');
    alt.classList.add('hidden');
    ok.classList.remove('hidden');
    ok.textContent = 'باشه';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden','false');

    const finish = () => {
      closeDialog();
      ok.removeEventListener('click', finish);
      resolve();
    };
    ok.addEventListener('click', finish, {once:true});
    ok.focus();
  });
}

function showAppConfirm(message, title='تأیید'){
  return showAppChoice(message, title, {
    primary:'تأیید',
    secondary:null,
    cancel:'انصراف'
  }).then(choice => choice === 'primary');
}

/**
 * Three-way dialog:
 * primary = save/confirm, secondary = discard, cancel = do nothing.
 * This deliberately stays open until the user taps one of the buttons.
 */
function showAppChoice(message, title='تأیید', labels = {}){
  return new Promise(resolve => {
    const {modal, title: titleEl, message: messageEl, cancel, alt, ok} = getDialogEls();
    if(!modal) return resolve('cancel');
    titleEl.textContent = title;
    messageEl.textContent = message;
    cancel.textContent = labels.cancel || 'انصراف';
    ok.textContent = labels.primary || 'تأیید';
    alt.textContent = labels.secondary || 'ذخیره نشود و حذف شود';
    cancel.classList.remove('hidden');
    ok.classList.remove('hidden');
    alt.classList.toggle('hidden', !labels.secondary);

    modal.classList.add('show');
    modal.setAttribute('aria-hidden','false');

    let done = false;
    const finish = value => {
      if(done) return;
      done = true;
      closeDialog();
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      alt.removeEventListener('click', onAlt);
      modal.removeEventListener('click', onBackdrop);
      resolve(value);
    };
    const onOk = () => finish('primary');
    const onCancel = () => finish('cancel');
    const onAlt = () => finish('secondary');
    const onBackdrop = event => { if(event.target === event.currentTarget) finish('cancel'); };

    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    alt.addEventListener('click', onAlt);
    modal.addEventListener('click', onBackdrop);
    ok.focus();
  });
}

function isShareCancellation(error){
  const text = String(error?.message || error || '').toLowerCase();
  return /cancel|cancell|dismiss|abort/.test(text);
}

async function resetSessionCounter(){
  const ok = await showAppConfirm('شمارنده سشن به ۱ بازنشانی شود؟\n\nتاریخچه سشن‌ها و معاملات حذف نخواهد شد.', 'ریست شمارنده');
  if(!ok) return;
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
function showInputAdjustment(id, message){
  const el = document.getElementById(id + 'Hint');
  if(!el) return;
  el.textContent = message || '';
  el.className = message ? 'small warn input-adjustment' : 'small input-adjustment';
}

function getValidPayout(){
  const raw = num('payout');
  let payout = raw;
  let message = '';
  if(payout <= 0){ payout = 0.01; message = 'Payout نامعتبر بود و به 0.01٪ اصلاح شد.'; }
  else if(payout > 500){ payout = 500; message = 'Payout از سقف 500٪ بیشتر بود و به 500٪ اصلاح شد.'; }
  showInputAdjustment('payout', message);
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
    showAppMessage('برای تغییر حالت، ابتدا یک سشن جدید شروع کنید (سشن فعلی معامله دارد).', 'تغییر حالت');
    return;
  }
  mode = m;
  document.getElementById('modeBtnSimple').classList.toggle('active', mode === 'simple');
  document.getElementById('modeBtnMasaniello').classList.toggle('active', mode === 'masaniello');
  document.getElementById('panelSimple').classList.toggle('hidden', mode !== 'simple');
  document.getElementById('panelMasaniello').classList.toggle('hidden', mode !== 'masaniello');
  document.getElementById('masaPlanBlock').classList.toggle('hidden', mode !== 'masaniello');
  document.getElementById('simplePlannerBlock')?.classList.toggle('hidden', mode !== 'simple');
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

function getUnifiedTarget(){
  const capital = num('initialCapital');
  const type = document.querySelector('input[name="mainTargetType"]:checked')?.value || 'percent';
  const value = parseFloat(document.getElementById('mainTargetValue')?.value);
  const safeValue = Number.isFinite(value) && value > 0 ? value : 0.01;
  const targetProfit = type === 'percent' ? capital * safeValue / 100 : safeValue;
  return { capital, type, value: safeValue, targetProfit, targetBalance: capital + targetProfit };
}

function syncUnifiedTarget(){
  const type=document.querySelector('input[name="mainTargetType"]:checked')?.value || 'percent';
  const value=parseFloat(document.getElementById('mainTargetValue')?.value);
  const capital=num('initialCapital');
  const safeValue=Number.isFinite(value) && value>0 ? value : 0.01;
  document.getElementById('mainTargetPercentLabel')?.classList.toggle('active',type==='percent');
  document.getElementById('mainTargetAmountLabel')?.classList.toggle('active',type==='amount');
  const label=document.getElementById('mainTargetValueLabel');
  if(label) label.textContent=type==='percent'?'هدف %':'هدف ($)';
}

function onSetupChange(){
  selectedPlannerPlan=null;
  syncUnifiedTarget();
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
    const plans=buildSimplePlans(initialCapital,num('payout'),getWinProfitAmount(),MIN_STAKE,getStopLossBalance());
    const p=selectedPlannerPlan?.valid ? selectedPlannerPlan : plans.find(x=>x.risk==='medium');
    simplePlanN=p?.n || 0;
    simplePlanK=p?.k || 0;
    return;
  }

  // masaniello
  capital0 = initialCapital;
  payout0 = num('payout');
  target0 = getUnifiedTarget().targetProfit;
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
  return getUnifiedTarget().targetProfit;
}
function getValidStopLossPct(){
  const raw = num('stopLossPct');
  let pct = raw;
  let message = '';
  if(pct <= 0){ pct = 0.01; message = 'حد ضرر نامعتبر بود و به 0.01٪ اصلاح شد.'; }
  else if(pct > 100){ pct = 100; message = 'حد ضرر از 100٪ بیشتر بود و به 100٪ اصلاح شد.'; }
  showInputAdjustment('stopLossPct', message);
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

  if(sessionPaused){
    showAlert('⏸ سشن در حالت مکث است — ابتدا آن را ادامه دهید.','warning');
    return;
  }

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
  if(locked) promptSessionEnd();
}

// Pure state mutation for a single trade outcome. `precomputedStake`, when
// given, skips a redundant getNextStake() call (logTrade() already computed
// it to validate the trade before calling this). The undo-replay below
// omits it on purpose — each replayed step needs a fresh calculation since
// balance/n/k change after every step.
function applyTradeMath(result, precomputedStake){
  const stake = precomputedStake ?? getNextStake().stake;
  const payout = mode === 'simple' ? getValidPayout() : getQuota() - 1;
  const state = applyTradeOutcome({
    balance,
    streakLoss,
    currentStreakCount,
    nRemaining: mode === 'masaniello' ? nRemaining : null,
    kRemaining: mode === 'masaniello' ? kRemaining : null,
    wins: 0, losses: 0, breakevens: 0, trades: 0
  }, result, stake, payout);

  balance = state.balance;
  if(mode === 'simple'){
    streakLoss = state.streakLoss;
    currentStreakCount = state.currentStreakCount;
  }else{
    nRemaining = state.nRemaining;
    kRemaining = state.kRemaining;
  }

  const ret = result === 'W' ? stake * payout : result === 'BE' ? 0 : -stake;
  trades.push({no: trades.length+1, result, amount: stake, ret, balance});
}


function evaluateLockState(){
  if(mode === 'simple'){
    checkStopLoss();
    const wins=trades.filter(t=>t.result==='W').length;
    const losses=trades.filter(t=>t.result==='L').length;
    if(!locked && simplePlanK>0 && wins>=simplePlanK){ locked=true; lockReason='target'; setStatus('✅ برنامه Simple به تعداد برد هدف رسید.','ok'); }
    else if(!locked && simplePlanN>0 && trades.length>=simplePlanN){ locked=true; lockReason='plan-complete'; setStatus('⚠ تعداد معاملات برنامه تمام شد.','warn'); }
    else if(!locked && simplePlanN>0 && losses>(simplePlanN-simplePlanK)){ locked=true; lockReason='plan-impossible'; setStatus('⚠ باخت مجاز برنامه تمام شد.','warn'); }
    checkOptionalAlerts();
  } else {
    if(balance <= 0){
      locked = true;
      lockReason = 'balance';
      setStatus('⚠ موجودی تمام شد — سشن جدید شروع کنید.', 'warn');
    } else if(kRemaining <= 0){
      locked = true;
      lockReason = 'target';
      setStatus('✅ سود هدف محقق شد! می‌توانید سشن جدید شروع کنید.', 'ok');
    } else if(nRemaining <= 0){
      locked = true;
      lockReason = 'plan-complete';
      setStatus('⚠ معاملات برنامه بدون رسیدن به هدف تمام شد.', 'warn');
    } else if(kRemaining > nRemaining){
      locked = true;
      lockReason = 'plan-impossible';
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
  lockReason = null;
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
    lockReason = 'stoploss';
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
    const targetProfit=getUnifiedTarget().targetProfit;
    const pl = balance - num('initialCapital');
    if(targetProfit > 0 && pl >= targetProfit){
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
  lockReason = null;
  selectedPlannerRisk = null;
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
function getLockReasonText(){
  const labels = {
    target:'هدف سشن محقق شده است.',
    stoploss:'حد ضرر سشن فعال شده است.',
    balance:'موجودی برای ادامه کافی نیست.',
    'plan-complete':'برنامه معاملات تمام شده است.',
    'plan-impossible':'رسیدن به هدف با معاملات باقی‌مانده دیگر ممکن نیست.'
  };
  return labels[lockReason] || 'پایان دستی سشن.';
}

async function promptSessionEnd(){
  if(sessionEndDialogOpen || trades.length === 0) return;
  sessionEndDialogOpen = true;
  const reason = getLockReasonText();
  const choice = await showAppChoice(
    `سشن به پایان رسیده است.\n\n${reason}\n\nذخیره و ورود به تاریخچه، یا حذف بدون ذخیره؟`,
    'پایان سشن',
    {primary:'ذخیره / تأیید', secondary:'ذخیره نشود / حذف شود', cancel:'انصراف'}
  );
  sessionEndDialogOpen = false;
  if(choice === 'cancel') return;
  if(choice === 'primary') saveSession();
  resetTradesState();
}

async function clearTrades(){
  if(trades.length === 0){
    resetTradesState();
    return;
  }

  const reason = lockReason ? `\n\nوضعیت پایان: ${getLockReasonText()}` : '\n\nپایان دستی سشن.';
  const choice = await showAppChoice(
    `سشن خاتمه داده شود؟${reason}`,
    'پایان سشن',
    {primary:'ذخیره / تأیید', secondary:'ذخیره نشود / حذف شود', cancel:'انصراف'}
  );
  if(choice === 'cancel') return;
  if(choice === 'primary') saveSession();
  resetTradesState();
}

async function newSession(){
  if(trades.length > 0){
    const reason = lockReason ? `\n\nعلت پایان: ${getLockReasonText()}` : '';
    const choice = await showAppChoice(
      `سشن فعلی تمام شود و سشن جدید شروع شود؟${reason}`,
      'سشن جدید',
      {primary:'ذخیره و شروع', secondary:'بدون ذخیره و شروع', cancel:'انصراف'}
    );
    if(choice === 'cancel') return;
    if(choice === 'primary') saveSession();

    if(document.getElementById('t-autoCopy')?.textContent === 'ON'){
      document.getElementById('initialCapital').value = formatNumber(balance);
    }
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

  renderDashboard();
  saveState();
}

async function clearHistory(){
  if(sessionHistory.length === 0) return;
  if(!await showAppConfirm('تاریخچه‌ی همه‌ی سشن‌ها پاک شود؟\n\nاین عمل قابل بازگشت نیست.', 'پاک کردن تاریخچه')) return;
  sessionHistory = [];
  renderHistory();
}

async function exportHistoryCSV(){
  if(sessionHistory.length === 0){
    await showAppMessage('تاریخچه‌ای برای خروجی گرفتن وجود ندارد.', 'خروجی CSV');
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
      if(!isShareCancellation(e)) await showAppMessage('خروجی گرفتن با خطا مواجه شد: ' + (e && e.message ? e.message : e), 'خطا در خروجی CSV');
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
   PERFORMANCE DASHBOARD + BACKUP
===================================================== */
function getLiveSessionSummary(){
  if(trades.length === 0) return null;
  return {
    trades: trades.length,
    wins: trades.filter(t => t.result === 'W').length,
    losses: trades.filter(t => t.result === 'L').length,
    breakevens: trades.filter(t => t.result === 'BE').length,
    initial: mode === 'simple' ? num('initialCapital') : capital0,
    finalBalance: balance,
    profit: balance - (mode === 'simple' ? num('initialCapital') : capital0)
  };
}

function renderDashboard(){
  const panel = document.getElementById('dashboardPanel');
  if(!panel) return;
  const stats = computePerformanceStats(sessionHistory, getLiveSessionSummary());

  const set = (id, value) => {
    const el = document.getElementById(id);
    if(el) el.textContent = value;
  };
  const signedMoney = value => {
    if(!Number.isFinite(value)) return '-';
    return (value > 0 ? '+' : '') + money(value);
  };

  set('dashSessions', stats.sessions);
  set('dashTrades', stats.trades);
  set('dashWinRate', stats.trades ? stats.winRate.toFixed(1) + '%' : '-');
  set('dashNetProfit', signedMoney(stats.netProfit));
  set('dashBest', stats.bestSession ? signedMoney(stats.bestSession.profit) : '-');
  set('dashWorst', stats.worstSession ? signedMoney(stats.worstSession.profit) : '-');
  set('dashDrawdown', stats.trades ? money(stats.maxDrawdownDollar) : '-');
  set('dashDrawdownPct', stats.trades ? stats.maxDrawdownPercent.toFixed(1) + '%' : '-');
  set('dashCurrentBalance', stats.currentBalance !== null ? money(stats.currentBalance) : '-');

  const current = getLiveSessionSummary();
  const liveEl = document.getElementById('dashLiveStatus');
  if(liveEl){
    liveEl.textContent = current
      ? `سشن جاری: ${current.wins}W / ${current.breakevens}BE / ${current.losses}L · ${signedMoney(current.profit)}`
      : 'سشن جاری: هنوز معامله‌ای ثبت نشده';
  }
}

function downloadTextFile(filename, text, type){
  const blob = new Blob([text], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportBackup(){
  const backup = {
    format: 'trade-manager-backup',
    formatVersion: 1,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    state: getPersistableState()
  };
  const filename = `TM.re3a.backup.${new Date().toISOString().slice(0,10)}.json`;
  const json = JSON.stringify(backup, null, 2);

  if(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()){
    try{
      const { Filesystem, Share } = window.Capacitor.Plugins;
      await Filesystem.writeFile({ path: filename, data: json, directory: 'CACHE', encoding: 'utf8' });
      const { uri } = await Filesystem.getUri({ directory: 'CACHE', path: filename });
      await Share.share({ title: 'Trade Manager Backup', url: uri });
      return;
    }catch(e){
      if(isShareCancellation(e)) return;
      await showAppMessage('ساخت فایل پشتیبان با خطا مواجه شد: ' + (e?.message || e), 'خطا');
      return;
    }
  }

  downloadTextFile(filename, json, 'application/json;charset=utf-8');
}

function validateBackupPayload(payload){
  if(!payload || payload.format !== 'trade-manager-backup' || payload.formatVersion !== 1 || !payload.state){
    return false;
  }
  const state = payload.state;
  return Array.isArray(state.trades) &&
    Array.isArray(state.sessionHistory) &&
    (state.mode === 'simple' || state.mode === 'masaniello');
}

async function restoreBackupFile(file){
  try{
    const text = await file.text();
    const payload = JSON.parse(text);
    if(!validateBackupPayload(payload)){
      await showAppMessage('این فایل پشتیبان متعلق به Trade Manager نیست یا ساختار آن معتبر نیست.', 'فایل نامعتبر');
      return;
    }
    if(!await showAppConfirm(
      'اطلاعات فعلی برنامه با این نسخه پشتیبان جایگزین می‌شود.\n\nتاریخچه و وضعیت فعلی برنامه نیز جایگزین خواهد شد.',
      'بازیابی پشتیبان'
    )) return;

    writeStoredState(payload.state);
    window.location.reload();
  }catch(e){
    await showAppMessage('خواندن فایل پشتیبان ممکن نشد: ' + (e?.message || e), 'خطا در بازیابی');
  }
}

function handleBackupImport(event){
  const file = event.target.files?.[0];
  event.target.value = '';
  if(file) restoreBackupFile(file);
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
function renderUnifiedTarget(){
  const capital=num('initialCapital');
  const type=document.querySelector('input[name="mainTargetType"]:checked')?.value || 'percent';
  const value=parseFloat(document.getElementById('mainTargetValue')?.value);
  const targetBalance=getUnifiedTarget().targetBalance;
  const el=document.getElementById('unifiedTargetBalance'); if(el) el.textContent=money(targetBalance);
}

function renderSimplePlanner(){
  const wrap=document.getElementById('simplePlannerOptions'); if(!wrap) return;
  const plans=buildSimplePlans(num('initialCapital'),num('payout'),getWinProfitAmount(),MIN_STAKE,getStopLossBalance());
  const labels={low:'کم‌ریسک',medium:'ریسک متوسط',high:'پرریسک'};
  wrap.innerHTML=plans.map(o=>{
    const selected=selectedPlannerRisk===o.risk;
    if(!o.valid) return `<button type="button" class="tp-risk-card disabled"><div class="tp-risk-title">${labels[o.risk]}</div><div>با ورودی فعلی قابل اجرا نیست</div></button>`;
    return `<button type="button" class="tp-risk-card selectable risk-${o.risk} ${selected?'selected':''}" data-simple-risk="${o.risk}">
      <div class="tp-risk-title">${labels[o.risk]}</div>
      <div><b>${o.n}</b><span> معامله</span></div>
      <div><b>${o.k}</b><span> برد هدف</span></div>
      <div><b>${o.n-o.k}</b><span> باخت مجاز</span></div>
      <div><b>${money(o.maxStake)}</b><span> بیشترین Stake</span></div>
      <div><b>${money(o.stopLossAmount)}</b><span> بودجه SL</span></div>
    </button>`;
  }).join('');
  wrap.querySelectorAll('[data-simple-risk]').forEach(btn=>btn.addEventListener('click',()=>selectPlannerRisk(btn.dataset.simpleRisk)));
  const info=document.getElementById('simplePlannerInfo');
  if(info){
    const p=plans.find(x=>x.risk===selectedPlannerRisk && x.valid);
    info.textContent=p ? `برنامه انتخاب‌شده: ${p.n} معامله، ${p.k} برد هدف و ${p.n-p.k} باخت مجاز. Target هر برد ${money(p.profitPerWin)} است.` : 'یک برنامه را انتخاب کنید.';
  }
}

function renderTradingPlan(){
  const summary=document.getElementById('plannerSummary');
  const info=document.getElementById('savedPlanInfo');
  if(!summary) return;
  renderUnifiedTarget();
  if(mode==='simple') renderSimplePlanner();
  if(mode==='masaniello') renderMasanielloPlanner(summary);
  else renderSimplePlannerSummary(summary);
  if(info) info.textContent = tradingPlan?.status === 'running' ? `برنامه ذخیره‌شده: ${tradingPlan.planName || 'برنامه فعلی'}` : '';
  const pause=document.getElementById('pauseSessionBtn');
  const resume=document.getElementById('resumeSessionBtn');
  const start=document.getElementById('startPlanBtn');
  const active=trades.length>0 && !sessionPaused;
  pause?.classList.toggle('hidden',!active);
  resume?.classList.toggle('hidden',!sessionPaused || trades.length===0);
  start?.classList.toggle('hidden',active || sessionPaused);
}

function renderMasanielloPlanner(summary){
  const plans=buildMasanielloPlans(num('initialCapital'),num('payout'),getUnifiedTarget().targetProfit,MIN_STAKE);
  const labels={low:'کم‌ریسک',medium:'ریسک متوسط',high:'پرریسک'};
  const current=selectedPlannerPlan || plans.find(p=>p.risk===selectedPlannerRisk) || plans.find(p=>p.risk==='medium');
  if(current?.valid){
    selectedPlannerPlan=current;
    const losses=current.n-current.k;
    summary.innerHTML=`<b>${labels[current.risk]||'Custom'}</b> · ${current.n} معامله · ${current.k} برد · ${losses} باخت مجاز<br><span class="small">هدف نهایی: ${money(current.targetBalance)} · نتیجه تضمینی: ${money(current.worstCaseFinal)}</span>`;
  }else summary.textContent='با ورودی‌های فعلی برنامه قابل محاسبه نیست.';
  const n=document.getElementById('tpEditTrades'), l=document.getElementById('tpEditLosses');
  if(current?.valid && n && l && document.activeElement!==n && document.activeElement!==l){ n.value=current.n; l.value=current.n-current.k; }
}

function renderSimplePlannerSummary(summary){
  const plans=buildSimplePlans(num('initialCapital'),num('payout'),getWinProfitAmount(),MIN_STAKE,getStopLossBalance());
  const current=selectedPlannerPlan || plans.find(p=>p.risk===selectedPlannerRisk) || plans.find(p=>p.risk==='medium');
  if(current?.valid){
    selectedPlannerPlan=current;
    summary.innerHTML=`<b>${current.label}</b> · ${current.n} معامله · ${current.k} برد هدف · ${current.n-current.k} باخت مجاز<br><span class="small">سود هدف هر برد: ${money(current.profitPerWin)} · بیشترین Stake: ${money(current.maxStake)} · بودجه SL: ${money(current.stopLossAmount)}</span>`;
    const n=document.getElementById('tpEditTrades'), l=document.getElementById('tpEditLosses');
    if(n && l && document.activeElement!==n && document.activeElement!==l){n.value=current.n;l.value=current.n-current.k;}
  }else summary.textContent='با ورودی‌های فعلی برنامه قابل محاسبه نیست.';
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
function createTradingPlan(planName, planStartBalance, targetPercent, targetBalance){
  const resolved = resolvePlanTarget(planStartBalance, targetPercent, targetBalance);
  tradingPlan = {
    id: generatePlanId(),
    enabled: true,
    planName: planName || '',
    planStartBalance,
    targetPercent: resolved.targetPercent,
    targetBalance: resolved.targetBalance,
    payoutPercent: num('payout'),
    riskOptions: computeTradingPlanRiskOptions(planStartBalance, resolved.targetBalance, num('payout')),
    planCreatedAt: new Date().toISOString(),
    status: 'running'
  };
  selectedPlannerRisk = 'medium';
  return tradingPlan;
}

function updateTradingPlan(planName, targetPercent, targetBalance){
  if(!tradingPlan) return null;
  const resolved = resolvePlanTarget(tradingPlan.planStartBalance, targetPercent, targetBalance);
  tradingPlan.planName = planName || '';
  tradingPlan.targetPercent = resolved.targetPercent;
  tradingPlan.targetBalance = resolved.targetBalance;
  tradingPlan.payoutPercent = num('payout');
  tradingPlan.riskOptions = computeTradingPlanRiskOptions(tradingPlan.planStartBalance, resolved.targetBalance, tradingPlan.payoutPercent);
  return tradingPlan;
}

function cancelTradingPlan(){
  if(tradingPlan) tradingPlan.status = 'cancelled';
}

function completeTradingPlan(){
  if(tradingPlan) tradingPlan.status = 'completed';
}

function selectPlannerRisk(risk){
  const options = mode === 'masaniello' ? buildMasanielloPlans(num('initialCapital'),num('payout'),getUnifiedTarget().targetProfit,MIN_STAKE) : buildSimplePlans(num('initialCapital'),num('payout'),getWinProfitAmount(),MIN_STAKE,getStopLossBalance());
  const option = options.find(o => o.risk === risk);
  if(!option || option.valid === false) return;
  selectedPlannerRisk = risk;
  selectedPlannerPlan = option;
  if(mode === 'masaniello'){
    document.getElementById('manualToggle').checked = false;
    document.getElementById('manualN').value = option.n;
    document.getElementById('manualK').value = option.k;
    applySetup();
  } else {
    // Target is already the shared targetBalance/targetProfit source; do not mirror it into legacy fields.
    document.getElementById('stopLossPct').value = ((option.stopLossAmount / num('initialCapital')) * 100).toFixed(2);
    applySetup();
  }
  render();
}

function previewPlannerEdit(){
  const n=parseInt(document.getElementById('tpEditTrades')?.value,10);
  const losses=parseInt(document.getElementById('tpEditLosses')?.value,10);
  const hint=document.getElementById('tpEditHint');
  if(!hint) return;
  if(!Number.isInteger(n)||!Number.isInteger(losses)||n<1||losses<0||losses>=n){hint.textContent='تعداد معاملات باید بیشتر از باخت مجاز باشد.';hint.className='small warn';return;}
  if(mode==='masaniello'){
    const checked=validateMasanielloCustom(num('initialCapital'),num('payout'),getUnifiedTarget().targetProfit,n,losses,MIN_STAKE);
    if(!checked.valid){hint.textContent='⚠ این ترکیب با Target فعلی قابل تضمین نیست.';hint.className='small warn';return;}
    hint.textContent=`Custom معتبر: ${n} معامله، ${n-losses} برد، ${losses} باخت مجاز، حداکثر Stake ${money(checked.maxStake)}.`;
  }else{
    const plans=buildSimplePlans(num('initialCapital'),num('payout'),getWinProfitAmount(),MIN_STAKE,getStopLossBalance());
    const base=plans.find(p=>p.n===n&&p.n-p.k===losses);
    hint.textContent=base?.valid ? `برنامه Simple: ${n} معامله، ${n-losses} برد هدف، ${losses} باخت مجاز.` : 'این ترکیب در پروفایل‌های پیشنهادی Simple نیست؛ با اعمال، یک برنامه Custom با منطق بازیابی Simple ساخته می‌شود.';
  }
  hint.className='small';
}

async function applyPlannerEdit(){
  if(trades.length > 0){
    await showAppMessage('ابتدا سشن فعلی را خاتمه/مکث کنید؛ برنامه جدید برای سشن بعدی اعمال می‌شود.', 'اجرای برنامه');
    return;
  }
  const n = parseInt(document.getElementById('tpEditTrades')?.value,10);
  const losses = parseInt(document.getElementById('tpEditLosses')?.value,10);
  if(mode !== 'masaniello') return;
  const capital = num('initialCapital');
  const payout = num('payout');
  const target = getUnifiedTarget().targetProfit;
  const checked = validateMasanielloCustom(capital,payout,target,n,losses,MIN_STAKE);
  if(!checked.valid){
    await showAppMessage(checked.reason === 'target' ? 'این ترکیب N/K با سرمایه، Payout و Target فعلی نمی‌تواند هدف را طبق قواعد Masaniello تضمین کند.' : 'ترکیب تعداد معاملات و باخت مجاز معتبر یا قابل محاسبه نیست.', 'برنامه نامعتبر');
    return;
  }
  document.getElementById('manualToggle').checked = true;
  document.getElementById('manualWrap').classList.add('show');
  document.getElementById('manualN').value = n;
  document.getElementById('manualK').value = n - losses;
  selectedPlannerRisk = 'custom';
  selectedPlannerPlan = checked;
  applySetup();
  render();
  await showAppMessage(`برنامه Custom آماده شد: ${n} معامله، ${n-losses} برد لازم و ${losses} باخت مجاز.\n\nحداکثر Stake برآوردی: ${money(checked.maxStake)}\nنتیجه تضمینی: ${money(checked.worstCaseFinal)}`, 'برنامه انتخاب شد');
}

async function onTradingPlanFormSubmit(){
  const planName = document.getElementById('tpFormName').value;
  const isPercent = document.querySelector('input[name="tpTargetType"]:checked').value === 'percent';
  const targetPercent = isPercent ? parseFloat(document.getElementById('tpFormTargetPercent').value) : NaN;
  const targetBalance = !isPercent ? parseFloat(document.getElementById('tpFormTargetBalance').value) : NaN;

  // Guard: the visible target field must contain a real number. Without
  // this, an empty active field silently resolves to targetPercent/
  // targetBalance both null (resolvePlanTarget's correct response to
  // "nothing was provided"), which callers here never expected to persist.
  const activeTargetValid = isPercent ? Number.isFinite(targetPercent) : Number.isFinite(targetBalance);
  if(!activeTargetValid){
    await showAppMessage('هدف برنامه را وارد کنید.', 'اطلاعات ناقص');
    return;
  }

  if(tradingPlanFormMode === 'edit'){
    updateTradingPlan(planName, targetPercent, targetBalance);
  } else {
    const planStartBalance = parseFloat(document.getElementById('tpFormStartBalance').value);
    if(!Number.isFinite(planStartBalance)){
      await showAppMessage('موجودی شروع برنامه را وارد کنید.', 'اطلاعات ناقص');
      return;
    }
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

async function onTradingPlanComplete(){
  if(!await showAppConfirm('برنامه به عنوان تکمیل‌شده علامت‌گذاری شود؟', 'تکمیل برنامه')) return;
  completeTradingPlan();
  render();
  clearTradingPlanForm();
}

async function onTradingPlanCancel(){
  if(!await showAppConfirm('این برنامه لغو شود؟', 'لغو برنامه')) return;
  cancelTradingPlan();
  render();
  clearTradingPlanForm();
}

function copyNextStake(){
  const r = !locked ? getNextStake() : {stake:0, reason:'locked'};
  if(locked || r.reason !== 'ok'){
    showAppMessage('مبلغ معامله بعدی در حال حاضر موجود نیست.', 'مبلغ معامله');
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
    navigator.clipboard.writeText(text).then(done).catch(() => showAppMessage('مبلغ: ' + text, 'مبلغ معامله'));
  } else {
    showAppMessage('مبلغ: ' + text, 'مبلغ معامله');
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
    const targetBalance = getUnifiedTarget().targetBalance;
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
    account_gain_target_percent: getUnifiedTarget().type === 'percent' ? getUnifiedTarget().value : (getUnifiedTarget().capital > 0 ? getUnifiedTarget().targetProfit / getUnifiedTarget().capital * 100 : 0),
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

  document.getElementById('winBtn').disabled = locked || sessionPaused;
  document.getElementById('beBtn').disabled = locked || sessionPaused;
  document.getElementById('lossBtn').disabled = locked || sessionPaused;

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
      const targetBalance = getUnifiedTarget().targetBalance;
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

  renderDashboard();
  saveState();
}

/* =====================================================
   CALCULATIONS (simple mode)
===================================================== */
function recalc(){
  const initialCapital = num('initialCapital');
  const target = getUnifiedTarget();
  const capitalFinal = target.targetBalance;
  const winProfit = target.targetProfit;
  const stopLossAmount = getStopLossAmount();
  const stopLossBalance = getStopLossBalance();

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


async function startSelectedPlan(){
  if(trades.length>0){ await showAppMessage('این سشن در حال اجراست. ابتدا آن را مکث یا خاتمه دهید.','شروع سشن'); return; }
  if(!selectedPlannerPlan || selectedPlannerPlan.valid===false){ await showAppMessage('ابتدا یک برنامه معتبر انتخاب کنید.','برنامه نامعتبر'); return; }
  if(mode==='masaniello'){
    const p=selectedPlannerPlan;
    document.getElementById('manualToggle').checked=true;
    document.getElementById('manualN').value=p.n;
    document.getElementById('manualK').value=p.k;
    riskLevel=p.risk==='custom'?'medium':p.risk;
  }else{
    document.getElementById('stopLossPct').value=((selectedPlannerPlan.stopLossAmount/num('initialCapital'))*100).toFixed(2);
  }
  applySetup();
  sessionPaused=false;
  await showAppMessage('برنامه تأیید شد. سشن آماده شروع است؛ اولین نتیجه را ثبت کنید.','سشن آماده شد');
  render();
}

async function pauseCurrentSession(){
  if(trades.length===0) return;
  sessionPaused=true;
  saveState();
  await showAppMessage('سشن با تمام وضعیت فعلی ذخیره شد. بعداً می‌توانید دقیقاً از همین نقطه ادامه دهید.','سشن ذخیره شد');
  render();
}

function resumeCurrentSession(){
  if(!sessionPaused || trades.length===0) return;
  sessionPaused=false;
  saveState();
  render();
}

function saveSelectedPlan(){
  if(!selectedPlannerPlan || selectedPlannerPlan.valid===false){ showAppMessage('ابتدا یک برنامه معتبر انتخاب کنید.','ذخیره برنامه'); return; }
  const capital=num('initialCapital');
  const targetBalance=getUnifiedTarget().targetBalance;
  const percent=capital>0 ? (targetBalance/capital-1)*100 : 0;
  tradingPlan={id:generatePlanId(),enabled:true,planName:`${mode==='masaniello'?'Masaniello':'Simple'} ${selectedPlannerPlan.risk==='custom'?'Custom':(selectedPlannerPlan.label||selectedPlannerPlan.risk)}`,planStartBalance:capital,targetPercent:percent,targetBalance,payoutPercent:num('payout'),selectedPlan:selectedPlannerPlan,mode,planCreatedAt:new Date().toISOString(),status:'running'};
  saveState(); render();
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
  $('appDialog')?.addEventListener('keydown', event => { if(event.key === 'Escape') event.preventDefault(); });
  document.addEventListener('keydown', event => {
    if(event.key === 'Escape') hideAbout();
  });

  $('winBtn')?.addEventListener('click', () => logTrade('W'));
  $('beBtn')?.addEventListener('click', () => logTrade('BE'));
  $('lossBtn')?.addEventListener('click', () => logTrade('L'));
  $('clearBtn')?.addEventListener('click', clearTrades);
  $('undoBtn')?.addEventListener('click', undoLastTrade);
  $('startPlanBtn')?.addEventListener('click', startSelectedPlan);
  $('pauseSessionBtn')?.addEventListener('click', pauseCurrentSession);
  $('resumeSessionBtn')?.addEventListener('click', resumeCurrentSession);
  $('pauseTopBtn')?.addEventListener('click', pauseCurrentSession);
  $('savePlanBtn')?.addEventListener('click', saveSelectedPlan);
  $('copyStakeBtn')?.addEventListener('click', copyNextStake);

  $('initialCapital')?.addEventListener('input', onSetupChange);
  $('mainTargetValue')?.addEventListener('input', onSetupChange);
  document.querySelectorAll('input[name="mainTargetType"]').forEach(input => input.addEventListener('change', onSetupChange));
  $('initialCapital')?.addEventListener('blur', formatCapitalInput);
  ['payout','stopLossPct','manualN','manualK'].forEach(id => $(id)?.addEventListener('input', onSetupChange));
  $('manualToggle')?.addEventListener('change', onManualToggle);
  document.querySelectorAll('.risklevels button').forEach(button => button.addEventListener('click', () => setRisk(button.dataset.risk)));

  document.querySelectorAll('input[name="tpTargetType"]').forEach(input => input.addEventListener('change', onTradingPlanTargetTypeChange));
  const planCreateButton = $('tradingPlanCreateView')?.querySelector('.subactions .btn');
  planCreateButton?.addEventListener('click', onTradingPlanFormSubmit);
  $('tpEditTrades')?.addEventListener('input', previewPlannerEdit);
  $('tpEditLosses')?.addEventListener('input', previewPlannerEdit);
  $('tpApplyBtn')?.addEventListener('click', applyPlannerEdit);

  const activeButtons = $('tradingPlanActiveView')?.querySelectorAll('.subactions .btn') || [];
  activeButtons[0]?.addEventListener('click', onTradingPlanEdit);
  activeButtons[1]?.addEventListener('click', onTradingPlanComplete);
  activeButtons[2]?.addEventListener('click', onTradingPlanCancel);

  const histButtons = document.querySelectorAll('.histbtns button');
  histButtons[0]?.addEventListener('click', exportHistoryCSV);
  histButtons[1]?.addEventListener('click', clearHistory);
  document.querySelector('.logbtn')?.addEventListener('click', toggleLog);
  $('backupExportBtn')?.addEventListener('click', exportBackup);
  $('backupImportBtn')?.addEventListener('click', () => $('backupImportInput')?.click());
  $('backupImportInput')?.addEventListener('change', handleBackupImport);
  $('copyBtn')?.addEventListener('click', copyLog);
}

function applyNativeTheme(){
  try{
    const native = window.Capacitor?.Plugins?.StatusBar;
    if(!native) return;
    native.setBackgroundColor?.({color:'#171c26'});
    native.setStyle?.({style:'DARK'});
  }catch(_){ /* web/PWA has no native status-bar plugin */ }
}

/* =====================================================
   INITIALIZATION
===================================================== */

bindUI();
applyNativeTheme();

const restored = loadState();
if(!restored){
  document.getElementById('modeBtnSimple').classList.add('active');
  document.querySelector('.risklevels button[data-risk="medium"]').classList.add('active');
  formatCapitalInput();
  applySetup();
}
syncUnifiedTarget();
if(!selectedPlannerRisk) selectedPlannerRisk='medium';
render();
renderHistory();
updateSessionCounter();

/* Session pill: normal click = new session, long-press = reset counter.
   Use a native click for the normal action because Android WebView can deliver
   pointer timing differently from desktop browsers. The long-press path marks
   the following click as consumed so it cannot start a second session. */
(function(){
  const pill = document.getElementById('sessionPill');
  if(!pill) return;
  const LONG_MS = 3000;
  let timer = null;
  let longFired = false;
  let suppressClick = false;

  pill.addEventListener('click', () => {
    if(suppressClick){
      suppressClick = false;
      return;
    }
    newSession();
  });

  function down(){
    longFired = false;
    if(timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      longFired = true;
      suppressClick = true;
      resetSessionCounter();
    }, LONG_MS);
  }

  function cancel(){
    if(timer){ clearTimeout(timer); timer = null; }
    if(!longFired) suppressClick = false;
  }

  pill.addEventListener('pointerdown', down);
  pill.addEventListener('pointerup', cancel);
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

