import { formatNumber, money, formatDateTime } from './core/format.js';
import { computePlan, guaranteedWorstCaseFinal, masanielloStake } from './core/masaniello.js';
import { calculateSimpleNextStake } from './core/simple.js';
import { generatePlanId, resolvePlanTarget, computeTradingPlanStats as computeTradingPlanStatsPure, computeTradingPlanRiskOptions, migrateTradingPlan } from './core/trading-plan.js';
import { computeHistoryWithCumulativeStats as computeHistoryWithCumulativeStatsPure, buildHistoryCSV } from './core/history.js';
import { readStoredState, writeStoredState } from './storage/state.js';
import { computePerformanceStats } from './core/analytics.js';
import { buildMasanielloPlans, buildSimplePlans, validateMasanielloCustom } from './core/planner.js';
import { applyTradeOutcome } from './core/session.js';
import { analyzePlan } from './core/plan-analyzer.js';
import { computeSessionStatistics } from './core/session-statistics.js';
import { simulateScenario, parseScenario } from './core/scenario-simulator.js';
import { buildWhatIfComparison } from './core/what-if.js';
import { scoreRisk } from './core/risk-engine.js';
import { calculateRecoveryStake, simulateRecoverySequence } from './core/recovery.js';
import { compareStrategies } from './core/strategy-comparison.js';
import { stressTestPlan } from './core/stress-testing.js';
import { PAYOUT_MIN, PAYOUT_MAX, normalizePayout, isValidPayout, payoutPercent } from './core/payout.js';

/* =====================================================
   STATE (shared between both modes — only one mode's
   engine runs at a time, so trades/balance/locked are shared)
===================================================== */
const MIN_STAKE = 1; // Pocket Option rule: minimum $1 per trade — not user-editable
const APP_VERSION = '2.10.0';

// Security: escape untrusted values before they are ever interpolated into an
// innerHTML template. Used for any field whose ultimate origin is a restored
// Backup file (trades[]/sessionHistory[] survive JSON.parse with whatever
// shape the file author chose — validateBackupPayload() rejects malformed
// backups, but this is the render-time safety net for anything that slips
// through as a same-typed-but-hostile string, e.g. `t.no = '<img src=x
// onerror=alert(1)>'`). Always call this for text-content interpolation.
function escapeHtml(value){
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Runtime error guard: unexpected JavaScript failures must never look like a
// silent freeze to the user. Keep the technical details in the console while
// showing a short, actionable message in the existing application dialog.
let runtimeErrorDialogOpen = false;
let stressRunBtnHandler = null;
function reportRuntimeError(kind, error){
  try{ console.error(`[Trade Manager] ${kind}`, error); }catch(_){ /* ignore logging failures */ }
  if(runtimeErrorDialogOpen) return;
  runtimeErrorDialogOpen = true;
  const message = kind === 'unhandledrejection'
    ? 'یک عملیات غیرمنتظره کامل نشد. ورودی‌ها را بررسی کنید و دوباره تلاش کنید.'
    : 'یک خطای غیرمنتظره رخ داد. ورودی‌ها را بررسی کنید و دوباره تلاش کنید.';
  try{
    Promise.resolve(showAppMessage(message, 'خطای برنامه')).finally(() => {
      runtimeErrorDialogOpen = false;
    });
  }catch(_){
    runtimeErrorDialogOpen = false;
    const alertBox = document.getElementById('alertBox');
    if(alertBox){
      alertBox.textContent = message;
      alertBox.className = 'alert warn';
    }
  }
}

if(typeof window !== 'undefined'){
  window.addEventListener('error', event => reportRuntimeError('error', event.error || event.message));
  window.addEventListener('unhandledrejection', event => reportRuntimeError('unhandledrejection', event.reason));
}

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
    capital0, payout0, target0, planned0, kRequired0, nRemaining, kRemaining,
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
    capital0 = saved.capital0 || 0;
    payout0 = saved.payout0 || 0;
    target0 = saved.target0 || 0;
    planned0 = saved.planned0 || 0;
    kRequired0 = saved.kRequired0 || 0;
    nRemaining = saved.nRemaining || 0;
    kRemaining = saved.kRemaining || 0;
    const inp = saved.inputs || {};
    if(inp.initialCapital) document.getElementById('initialCapital').value = inp.initialCapital;
    if(inp.payout) { document.getElementById('payout').value = inp.payout; normalizePayoutField(); }

    tradingPlan = migrateTradingPlan(
      saved.tradingPlan || null,
      getPayoutPercent()
    );
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

    // restore manual-plan panel visibility
    document.getElementById('manualWrap').classList.toggle('show', !!inp.manualToggle);

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
function normalizePayoutInput(value){ return normalizePayout(value); }
function getPayoutFraction(){ return normalizePayoutInput(num('payout')); }
function getPayoutPercent(){ return payoutPercent(num('payout')); }
function normalizePayoutField(){
  const el=document.getElementById('payout');
  if(!el) return;
  const raw=String(el.value ?? '').trim();
  const n=Number(raw);
  if(!Number.isFinite(n) || n<=0) return;
  // Read-side normalization only. The visible field always keeps the unit
  // the user typed (e.g. "85"); normalizePayout()/getPayoutFraction()/
  // getPayoutPercent() are the single source of truth every calculation
  // reads from, so the display never needs to be rewritten into a
  // different unit for the engines to work correctly.
}

function intNum(id){
  const v = parseInt(document.getElementById(id).value, 10);
  return Number.isFinite(v) ? v : 0;
}

/* UI-only protection: explain invalid input instead of allowing a
   calculation path to look frozen or fail silently. */
const UI_DISCLOSURE_KEY = 'trade-manager-ui-disclosures-v1';

function validateSetupInputs({showMessage=false} = {}){
  const checks = [
    ['initialCapital', value => Number.isFinite(value) && value > 0, 'موجودی اولیه باید یک عدد بزرگ‌تر از صفر باشد.'],
    ['payout', value => isValidPayout(value), `Payout باید بین ۱٪ و ۱۰۰٪ باشد (مثلاً 85 = 85٪).`],
    ['mainTargetValue', value => Number.isFinite(value) && value > 0, 'Target باید یک عدد بزرگ‌تر از صفر باشد.']
  ];
  if(mode === 'simple'){
    checks.push(['stopLossPct', value => Number.isFinite(value) && value > 0 && value <= 100, 'Stop Loss باید بین 0.01٪ و 100٪ باشد.']);
  }
  for(const [id, rule, message] of checks){
    const el = document.getElementById(id);
    if(!el) continue;
    const raw = String(el.value ?? '').replace(/[$,\s]/g,'');
    const value = id === 'payout' ? normalizePayoutInput(raw) : parseFloat(raw);
    if(!raw || !rule(value)){
      el.setAttribute('aria-invalid','true');
      showInputAdjustment(id, message);
      if(showMessage) showAppMessage(message, 'ورودی نامعتبر');
      return {valid:false, id, message};
    }
    el.removeAttribute('aria-invalid');
    showInputAdjustment(id, '');
  }
  return {valid:true};
}

function getUiDisclosureState(){
  try{
    const raw = localStorage.getItem(UI_DISCLOSURE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  }catch(_){ return {}; }
}

function saveUiDisclosureState(id, open){
  try{
    const state = getUiDisclosureState();
    state[id] = !!open;
    localStorage.setItem(UI_DISCLOSURE_KEY, JSON.stringify(state));
  }catch(_){ /* UI preference only */ }
}

function restoreUiDisclosures(){
  const state = getUiDisclosureState();
  document.querySelectorAll('details.collapsible-panel[id], #advDetails, #historyDetails').forEach(details => {
    if(Object.prototype.hasOwnProperty.call(state, details.id)){
      details.open = !!state[details.id];
    }
    details.addEventListener('toggle', () => saveUiDisclosureState(details.id, details.open));
  });
}

function renderRiskAdvisor(){
  const statusEl = document.getElementById('riskAdvisorStatus');
  const detailEl = document.getElementById('riskAdvisorDetail');
  const strip = document.getElementById('riskAdvisorStrip');
  const toggle = document.getElementById('riskAdvisorToggle');
  if(!statusEl || !detailEl || !strip) return;
  const setState = s => { strip.dataset.state = s; if(toggle) toggle.dataset.state = s; };

  const validation = validateSetupInputs();
  if(!validation.valid){
    statusEl.textContent = '⚠ ورودی نیاز به بررسی دارد';
    detailEl.textContent = validation.message;
    setState('warn');
    return;
  }

  const plan = getAnalyzerPlan();
  if(!plan || plan.valid === false){
    statusEl.textContent = '⚠ برنامه قابل اجرا نیست';
    detailEl.textContent = 'Target، Payout، Stop Loss یا ریسک انتخابی را بررسی کنید.';
    setState('danger');
    return;
  }

  const target = getUnifiedTarget();
  const result = analyzePlan({
    mode,
    capital: num('initialCapital'),
    payoutPct: getPayoutPercent(),
    targetBalance: target.targetBalance,
    stopLossBalance: getStopLossBalance(),
    plan,
    minStake: MIN_STAKE
  });

  if(!result.valid){
    statusEl.textContent = '⚠ تحلیل کامل نشد';
    detailEl.textContent = 'ورودی‌ها یا برنامه فعلی قابل تحلیل نیستند.';
    setState('warn');
    return;
  }

  const safe = result.status === 'safe' && result.targetReachable && result.stopLossSafe;
  const next = trades.length && !locked ? getNextStake() : null;
  const stakeText = next?.reason === 'ok' ? money(next.stake) : (result.initialStake !== null ? money(result.initialStake) : '—');
  statusEl.textContent = safe ? '✓ برنامه فعلی قابل اجراست' : '⚠ برنامه فعلی فشار ریسک دارد';
  detailEl.textContent = `${mode === 'simple' ? 'Simple' : 'Masaniello'} · Stake ${stakeText} · Max DD ${money(result.maxDrawdown)}`;
  setState(safe ? 'ok' : 'warn');
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
  const raw=num('payout');
  let payout=normalizePayoutInput(raw);
  let message='';
  if(!isValidPayout(payout)){
    payout = payout > PAYOUT_MAX ? PAYOUT_MAX : PAYOUT_MIN;
    message = payout === PAYOUT_MAX
      ? `Payout نباید بیشتر از ۱۰۰٪ باشد.`
      : `Payout باید بین ۱٪ و ۱۰۰٪ باشد.`;
  }
  // The returned value is always the normalized fraction used by every
  // calculation; the visible input field is left exactly as the user
  // typed it (e.g. "85"), matching the boundary-normalization contract.
  showInputAdjustment('payout',message);
  return payout;
}

function getQuota(){
  return 1 + getValidPayout() * 100 / 100; // 1 + payout%/100, kept explicit for readability
}

/* =====================================================
   MODE SWITCH
===================================================== */
// Pure UI/presentation switch — only affects which of the "برنامه" /
// "آمار" columns is visible on narrow (max-width:900px) screens. Both
// columns keep rendering their real content at all times either way;
// this never touches session/plan state.
function switchSectionTab(name){
  document.querySelectorAll('[data-section-tab]').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.sectionTab === name);
  });
  document.querySelectorAll('[data-section-panel]').forEach(panel=>{
    panel.classList.toggle('section-active', panel.dataset.sectionPanel === name);
  });
}

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
  if(!isNaN(num)) startInput.value = formatNumber(num);
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
  const validation = validateSetupInputs();
  if(!validation.valid){
    clearTimeout(setupDebounceTimer);
    setStatus(validation.message, 'warn');
    renderRiskAdvisor();
    return;
  }
  // A previously invalid value must not leave a stale warning visible once
  // the current inputs are valid. Recalculation below will set the normal state.
  clearAlert();
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
  if(on && !document.getElementById('manualN').value){
    document.getElementById('manualN').value = planned0 || 10;
    document.getElementById('manualK').value = kRequired0 || 6;
  }
  onSetupChange();
}

function applySetup(){
  const initialCapital = num('initialCapital');
  sessionStartTime = new Date().toISOString();

  if(mode === 'simple'){
    balance = initialCapital;
    streakLoss = 0;
    currentStreakCount = 0;
    const plans=buildSimplePlans(initialCapital,getPayoutPercent(),getWinProfitAmount(),MIN_STAKE,getStopLossBalance());
    const p=selectedPlannerPlan?.valid ? selectedPlannerPlan : plans.find(x=>x.risk==='medium');
    simplePlanN=p?.n || 0;
    simplePlanK=p?.k || 0;
    return;
  }

  // masaniello
  capital0 = initialCapital;
  payout0 = getPayoutPercent();
  target0 = getUnifiedTarget().targetProfit;
  const floor = MIN_STAKE;

  const manualOn = document.getElementById('manualToggle').checked;
  if(manualOn){
    planned0 = Math.max(1, intNum('manualN'));
    kRequired0 = Math.min(planned0, Math.max(1, intNum('manualK')));
  } else {
    // Use the same selected-plan source of truth as the on-screen risk
    // cards (selectPlannerRisk), so the plan shown to the user is always
    // the plan that actually starts. See Project Changelog rule 2.5
    // (Source of Truth).
    const plans = buildMasanielloPlans(capital0, payout0, target0, floor);
    const plan = selectedPlannerPlan?.valid ? selectedPlannerPlan
      : plans.find(p => p.risk === selectedPlannerRisk && p.valid) || plans.find(p => p.risk === 'medium' && p.valid);
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
  const sessionTargetProfit = getWinProfitAmount();
  // simplePlanK is the plan's win count; the engine needs the per-win
  // profit target, not the whole-session target (see Planner/Plan
  // Analyzer, which already divide by k the same way).
  const targetProfit = simplePlanK > 0 ? sessionTargetProfit / simplePlanK : sessionTargetProfit;
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

  const validation = validateSetupInputs({showMessage:true});
  if(!validation.valid) return;

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
    {primary:'Save & Exit', secondary:'Discard & Exit', cancel:'Cancel'}
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
    {primary:'Save & Exit', secondary:'Discard & Exit', cancel:'Cancel'}
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
  const stats = computeSessionStatistics(trades, initial);

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
    winProfit: trades.filter(t => t.result === 'W').reduce((sum,t) => sum + Math.max(0, Number(t.ret)||0), 0),
    lossAmount: trades.filter(t => t.result === 'L').reduce((sum,t) => sum + Math.max(0, -(Number(t.ret)||0)), 0),
    maxWinStreak: stats.maxWinStreak,
    maxLossStreak: stats.maxLossStreak,
    maxDrawdown: stats.maxDrawdown,
    maxDrawdownPct: stats.maxDrawdownPct,
    averageStake: trades.length ? trades.reduce((sum,t) => sum + Math.max(0, Number(t.amount) || 0), 0) / trades.length : 0,
    maxStake: trades.length ? Math.max(...trades.map(t => Math.max(0, Number(t.amount) || 0))) : 0,
    endReason: lockReason || 'MANUAL',
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
    wrap.innerHTML = '<div class="small empty-history-state">هنوز سشنی ثبت نشده</div>';
    saveState();
    return;
  }
  const enriched = computeHistoryWithCumulativeStats();
  const trendIcon = { up: '▲', down: '▼', flat: '–' };
  const trendClass = { up: 'trend-up', down: 'trend-down', flat: '' };
  wrap.innerHTML = enriched.slice().reverse().map(s => `
    <div class="histrow-wrap">
      <div class="histrow">
        <span>#${escapeHtml(s.session)} · ${s.mode === 'simple' ? 'Simple' : 'Masaniello'} · ${escapeHtml(s.trades)} معامله (${escapeHtml(s.wins)}W/${escapeHtml(s.breakevens || 0)}BE/${escapeHtml(s.losses)}L)</span>
        <span class="hp ${s.profit < 0 ? 'neg' : 'pos'}">${money(s.profit)}</span>
      </div>
      <div class="histrow-sub">
        <span>برد تجمعی: ${s.cumulativeWinRate.toFixed(1)}%</span>
        <span class="${trendClass[s.trend]}">${trendIcon[s.trend]}</span>
      </div>
    </div>
  `).join('');

  renderDashboard();
  renderRiskAdvisor();
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
  set('dashBERate', stats.trades ? stats.beRate.toFixed(1) + '%' : '-');
  set('dashLossRate', stats.trades ? stats.lossRate.toFixed(1) + '%' : '-');
  set('dashProfitFactor', stats.profitFactor === Infinity ? '∞' : (stats.trades ? stats.profitFactor.toFixed(2) : '-'));
  set('dashAverageStake', stats.averageStake !== null ? money(stats.averageStake) : '-');
  set('dashMaxStake', stats.maxStake !== null ? money(stats.maxStake) : '-');
  set('dashHistoricalMaxLossStreak', stats.maxLossStreak !== null ? String(stats.maxLossStreak) : '-');
  set('dashCurrentBalance', stats.currentBalance !== null ? money(stats.currentBalance) : '-');

  const current = getLiveSessionSummary();
  const initialSessionBalance = mode === 'simple' ? num('initialCapital') : capital0;
  const sessionStats = computeSessionStatistics(trades, initialSessionBalance);
  const next = trades.length === 0 || locked ? null : getNextStake();
  set('dashSessionBalance', money(sessionStats.finalBalance));
  set('dashSessionProfit', signedMoney(sessionStats.profit));
  set('dashSessionReturn', sessionStats.returnPct.toFixed(1) + '%');
  set('dashSessionBE', sessionStats.breakevens);
  set('dashSessionLossRate', sessionStats.lossRate.toFixed(1) + '%');
  set('dashCurrentWinStreak', sessionStats.currentWinStreak);
  set('dashCurrentLossStreak', sessionStats.currentLossStreak);
  set('dashMaxLossStreak', sessionStats.maxLossStreak);
  set('dashSessionDrawdown', money(sessionStats.maxDrawdown));
  set('dashSessionDrawdownPct', sessionStats.maxDrawdownPct.toFixed(1) + '%');
  set('dashNextStake', next && next.reason === 'ok' ? money(next.stake) : '—');
  set('dashToTarget', (() => {
    const target = getUnifiedTarget();
    return Number.isFinite(target.targetBalance) ? money(Math.max(0, target.targetBalance - balance)) : '—';
  })());
  set('dashToStopLoss', (() => {
    const sl = getStopLossBalance();
    return Number.isFinite(sl) ? money(Math.max(0, balance - sl)) : '—';
  })());
  set('dashAverageWin', money(stats.averageWin));
  set('dashAverageLoss', money(stats.averageLoss));

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

// Layer 1 of the Stored-XSS fix (see AUDIT finding #3): a Backup file is
// untrusted input — it can be hand-edited or come from anywhere. Previously
// only the top-level shape (arrays vs. not, mode enum) was checked; any
// object inside trades[]/sessionHistory[] was accepted as-is and later
// interpolated into innerHTML by render()/renderHistory(). Reject the whole
// backup unless every trade/session entry has the exact primitive types the
// app itself would have written. Layer 2 (escapeHtml at render time) stays
// as defense-in-depth on top of this.
function isValidTradeEntry(t){
  return t && typeof t === 'object' &&
    Number.isFinite(t.no) &&
    (t.result === 'W' || t.result === 'BE' || t.result === 'L') &&
    Number.isFinite(t.amount) &&
    Number.isFinite(t.ret) &&
    Number.isFinite(t.balance);
}

function isValidSessionHistoryEntry(s){
  return s && typeof s === 'object' &&
    Number.isFinite(s.session) &&
    (s.mode === 'simple' || s.mode === 'masaniello') &&
    Number.isFinite(s.trades) &&
    Number.isFinite(s.wins) &&
    (s.breakevens === undefined || Number.isFinite(s.breakevens)) &&
    Number.isFinite(s.losses) &&
    Number.isFinite(s.profit) &&
    Number.isFinite(s.initial) &&
    Number.isFinite(s.finalBalance) &&
    typeof s.date === 'string';
}

function validateBackupPayload(payload){
  if(!payload || payload.format !== 'trade-manager-backup' || payload.formatVersion !== 1 || !payload.state){
    return false;
  }
  const state = payload.state;
  return Array.isArray(state.trades) &&
    Array.isArray(state.sessionHistory) &&
    (state.mode === 'simple' || state.mode === 'masaniello') &&
    state.trades.every(isValidTradeEntry) &&
    state.sessionHistory.every(isValidSessionHistoryEntry);
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
  const plans=buildSimplePlans(num('initialCapital'),getPayoutPercent(),getWinProfitAmount(),MIN_STAKE,getStopLossBalance());
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

function getAnalyzerPlan(){
  if(mode === 'masaniello'){
    const plans = buildMasanielloPlans(num('initialCapital'), getPayoutPercent(), getUnifiedTarget().targetProfit, MIN_STAKE);
    return selectedPlannerPlan?.valid ? selectedPlannerPlan : plans.find(p => p.risk === selectedPlannerRisk && p.valid) || plans.find(p => p.risk === 'medium' && p.valid);
  }
  const plans = buildSimplePlans(num('initialCapital'),getPayoutPercent(), getWinProfitAmount(), MIN_STAKE, getStopLossBalance());
  return selectedPlannerPlan?.valid ? selectedPlannerPlan : plans.find(p => p.risk === selectedPlannerRisk && p.valid) || plans.find(p => p.risk === 'medium' && p.valid);
}

function openPlanAnalyzer(){
  const plan = getAnalyzerPlan();
  if(!plan || plan.valid === false){
    showAppMessage('با ورودی‌های فعلی برنامه معتبری برای تحلیل وجود ندارد. ابتدا Target، Payout و Stop Loss را بررسی کنید.', 'تحلیل برنامه');
    return;
  }
  const target = getUnifiedTarget();
  const capital = num('initialCapital');
  const stopLossBalance = getStopLossBalance();
  const result = analyzePlan({ mode, capital, payoutPct:getPayoutPercent(), targetBalance:target.targetBalance, stopLossBalance, plan, minStake:MIN_STAKE });
  const modal=document.getElementById('planAnalyzerModal'), body=document.getElementById('planAnalyzerBody');
  if(!modal||!body||!result.valid) return;
  const risk=scoreRisk({
    capital,
    targetBalance:target.targetBalance,
    stopLossBalance,
    initialStake:result.initialStake,
    maxStake:result.maxStake,
    maxDrawdown:result.maxDrawdown,
    maxLossStreak:result.maxLossStreak,
    recoveryExposure:result.losses.reduce((sum,row)=>sum+(Number(row.stake)||0),0)
  });
  const signed=v=>(v>0?'+':'')+money(v);
  const levelClass={safe:'analyzer-good',moderate:'analyzer-good',high:'analyzer-warn',extreme:'analyzer-bad'}[risk.level]||'analyzer-warn';
  const lossRows=result.losses.length?result.losses.map(row=>`<div class="analyzer-loss-row"><span>باخت ${row.index}</span><b>${row.reason==='loss'?money(row.stake):'—'}</b><strong>${money(row.balance)}</strong></div>`).join(''):'<div class="small">هیچ باخت پیاپی قابل شبیه‌سازی نیست.</div>';
  const recovery=calculateRecoveryStake({balance:capital,payout:getPayoutFraction(),targetProfit:target.targetProfit,accumulatedLoss:0,stopLossBalance,maxStake:result.maxStake,maxDrawdown:Math.max(0,capital-stopLossBalance),maxAttempts:3,minStake:MIN_STAKE});
  body.innerHTML=`
    <div class="analyzer-status ${levelClass}">● ${risk.label} · امتیاز ساختاری ${risk.score}/100</div>
    <div class="analyzer-grid">
      <div><span>سرمایه</span><b>${money(result.capital)}</b></div>
      <div><span>Target</span><b>${money(result.targetBalance)}</b></div>
      <div><span>Stop Loss</span><b>${result.stopLossBalance===null?'—':money(result.stopLossBalance)}</b></div>
      <div><span>Stake اولیه</span><b>${result.initialStake===null?'—':money(result.initialStake)}</b></div>
      <div><span>بیشترین Stake</span><b>${money(result.maxStake)}</b></div>
      <div><span>Max Drawdown</span><b>${money(result.maxDrawdown)}</b></div>
      <div><span>Max Loss Streak</span><b>${result.maxLossStreak}</b></div>
      <div><span>نتیجه بدترین حالت</span><b>${result.worstCaseFinal===null?'—':money(result.worstCaseFinal)}</b></div>
    </div>
    <div class="analyzer-checks">
      <div class="${result.targetReachable?'ok':'bad'}">${result.targetReachable?'✓':'✕'} رسیدن به Target</div>
      <div class="${result.stopLossSafe?'ok':'bad'}">${result.stopLossSafe?'✓':'✕'} حفاظت Stop Loss</div>
    </div>
    <div class="analyzer-section-title">Recovery محدودشده</div>
    <div class="analyzer-note">${recovery.canRecover?`Stake لازم برای جبران زیان فعلی و سود هدف: <b>${money(recovery.stake)}</b>`:'Recovery با محدودیت‌های فعلی قابل اجرا نیست.'} · Recovery موتور جدیدی برای تغییر Simple/Masaniello نیست؛ فقط ابزار تصمیم‌گیری است.</div>
    <div class="analyzer-section-title">اگر چند باخت پشت‌سرهم داشته باشم چه می‌شود؟</div>
    <div class="analyzer-loss-list">${lossRows}</div>
    <div class="analyzer-note">${risk.warnings.length?risk.warnings.map(w=>`• ${w}`).join('<br>'):'هشدار ساختاری خاصی در این ورودی دیده نشد.'}</div>
    <div class="analyzer-note">این امتیاز یک مدل شفاف و ساختاری برای مقایسه است، نه احتمال برد/باخت بازار.</div>`;
  modal.classList.add('show'); modal.setAttribute('aria-hidden','false');
}

function openStrategyComparison(){
  const target=getUnifiedTarget();
  const comparison=compareStrategies({capital:num('initialCapital'),payoutPct:getPayoutPercent(),targetBalance:target.targetBalance,stopLossBalance:getStopLossBalance(),minStake:MIN_STAKE});
  if(!comparison.valid){ showAppMessage('برای مقایسه، Capital، Payout و Target معتبر لازم است.','مقایسه استراتژی'); return; }
  const modal=document.getElementById('strategyComparisonModal'), body=document.getElementById('strategyComparisonBody');
  if(!modal||!body) return;
  const cells=comparison.rows.map(r=>{
    const scenario=r.scenario||{}; const worst=r.worstCase||{}; const risk=r.risk||{};
    return `<div class="comparison-card ${r.valid?'':'invalid'}"><div class="comparison-title">${r.strategy}</div>
      <div><span>ریسک ساختاری</span><b>${risk.label||'نامشخص'}${risk.valid?' · '+money(risk.score):''}</b></div>
      <div><span>Stake اولیه</span><b>${r.initialStake==null?'—':money(r.initialStake)}</b></div>
      <div><span>میانگین Stake</span><b>${money(r.averageStake)}</b></div>
      <div><span>Max Stake</span><b>${money(r.maxStake)}</b></div>
      <div><span>Max DD</span><b>${money(r.maxDrawdown)}</b></div>
      <div><span>Worst Case Balance</span><b>${money(r.worstCaseFinal)}</b></div>
      <div><span>سناریوی فعلی</span><b>${money(scenario.finalBalance)} · ${scenario.trades} معامله</b></div>
      <div><span>Target</span><b>${scenario.targetHit?'رسید':'نرسید'}</b></div>
      <div><span>Stop Loss</span><b>${scenario.stopLossHit?'فعال شد':'فعال نشد'}</b></div>
      ${!r.valid?`<div class="analyzer-bad"><span>وضعیت</span><b>${r.invalidReason||'نامعتبر'}</b></div>`:''}
    </div>`;
  }).join('');
  body.innerHTML=`<div class="small">هر سه رویکرد با Capital، Payout، Target و Stop Loss یکسان مقایسه می‌شوند. Worst Case با سناریوی تمام Loss و طول کافی محاسبه شده است. امتیاز Risk یک امتیاز ساختاری تصمیم‌یار است، نه احتمال واقعی ضرر.</div><div class="comparison-grid">${cells}</div>`;
  modal.classList.add('show'); modal.setAttribute('aria-hidden','false');
}

function openStressTesting(){
  const target=getUnifiedTarget();
  const plan=getScenarioPlan();
  const modal=document.getElementById('stressTestingModal'),body=document.getElementById('stressTestingBody');
  if(!modal||!body) return;
  if(!plan||plan.valid===false){ showAppMessage('ابتدا یک برنامه معتبر انتخاب کنید.','Stress Test'); return; }
  modal.classList.add('show'); modal.setAttribute('aria-hidden','false');
  const run=()=>{
    const customInput=document.getElementById('stressCustomInput');

    const normalizeStressScenario = (value) => {
      const raw = String(value ?? '')
        .toUpperCase()
        .replace(/→|->|>/g, ',')
        .trim();

      const tokens = raw
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);

      const valid = tokens.length > 0 &&
        tokens.every(v => v === 'W' || v === 'L' || v === 'BE');

      return {
        valid,
        value: valid ? tokens.join(',') : ''
      };
    };

    const stressScenario = normalizeStressScenario(customInput?.value);

    if (!stressScenario.valid) {
      const results=document.getElementById('stressResults');
      if(results){
        results.innerHTML='<div class="scenario-error">⚠ سناریو نامعتبر است. فقط W، L و BE وارد کنید.</div>';
      }
      return;
    }
    const custom=parseScenario(customInput?.value||'');
    const probs={
      win:Number(document.getElementById('stressWinProb')?.value)/100,
      loss:Number(document.getElementById('stressLossProb')?.value)/100,
      be:Number(document.getElementById('stressBEProb')?.value)/100
    };
    const result=stressTestPlan({mode,capital:num('initialCapital'),payout:getValidPayout(),targetProfit:target.targetProfit,stopLossBalance:getStopLossBalance(),plan,minStake:MIN_STAKE,seed:42,trades:Math.max(8,Number(plan.n)||8),customResults:stressScenario.value,probabilities:probs});
    const results=document.getElementById('stressResults');
    if(!results) return;
    if(!result.valid){ results.innerHTML=`<div class="scenario-error">⚠ ${result.reason==='invalid-probabilities'?'احتمال‌های Win / Loss / BE باید جمعاً 100٪ شوند.':'Stress Test قابل اجرا نیست.'}</div>`; return; }
    const labels={best:'Best Case',normal:'Normal Case',worst:'Worst Case',custom:'Custom',random:'Random (seed 42)'};
    results.innerHTML=`<div class="stress-grid">${result.scenarios.map(sc=>{const r=sc.simulation;return `<div class="stress-card"><strong>${labels[sc.kind]}</strong><span>${sc.results.length?sc.results.join(' → '):'—'}</span><b>${money(r.finalBalance)}</b><small>Profit ${r.profit>0?'+':''}${money(r.profit)} · DD ${money(r.maxDrawdown)} · Max Loss Streak ${r.maxLossStreak}</small><small>${r.locked?(r.lockReason||'قفل'):'ادامه‌پذیر'} · ${r.targetHit?'Target ✓':'Target —'} · ${r.stopLossHit?'Stop Loss ✓':'Stop Loss —'}</small></div>`}).join('')}</div><div class="small">Random با seed ثابت 42 قابل تکرار است. احتمال‌ها فقط برای ساخت سناریوی تصادفی هستند و Random جایگزین محاسبه قطعی برنامه نیست.</div>`;
  };
  const runBtn=document.getElementById('stressRunBtn');
  if(runBtn){
    if(stressRunBtnHandler) runBtn.removeEventListener('click',stressRunBtnHandler);
    stressRunBtnHandler=run;
    runBtn.addEventListener('click',stressRunBtnHandler);
  }
  run();
}

function closeStrategyComparison(){ const m=document.getElementById('strategyComparisonModal'); if(m){m.classList.remove('show');m.setAttribute('aria-hidden','true');} }
function closeStressTesting(){ const m=document.getElementById('stressTestingModal'); if(m){m.classList.remove('show');m.setAttribute('aria-hidden','true');} }

function getScenarioPlan(){
  return getAnalyzerPlan();
}

function getWhatIfPlan(){
  return getAnalyzerPlan();
}

function openWhatIfLab(){
  const plan = getWhatIfPlan();
  const modal = document.getElementById('whatIfModal');
  const body = document.getElementById('whatIfBody');
  if(!modal || !body) return;
  if(!plan || plan.valid === false){
    showAppMessage('ابتدا یک برنامه معتبر بسازید تا مقایسه سناریو ممکن باشد.', 'What-If Lab');
    return;
  }
  const currentResults = trades.map(t => t.result).filter(Boolean);
  if(currentResults.length === 0){
    showAppMessage('برای تحلیل What-If ابتدا حداقل یک معامله در سشن ثبت کنید.', 'What-If Lab');
    return;
  }
  renderWhatIfLab();
  modal.classList.add('show');
  modal.setAttribute('aria-hidden','false');
}

function closeWhatIfLab(){
  const modal=document.getElementById('whatIfModal');
  if(!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden','true');
}

function renderWhatIfLab(){
  const plan=getWhatIfPlan();
  const body=document.getElementById('whatIfBody');
  if(!body || !plan) return;
  const actual=trades.map(t=>t.result).filter(Boolean);
  const target=getUnifiedTarget();
  const options=actual.map((result,index)=>`
    <option value="${index}">معامله ${index+1} — ${result}</option>`).join('');
  body.innerHTML=`
    <div class="whatif-intro">یک معامله از سشن فعلی را انتخاب کنید و نتیجه جایگزین را ببینید. سشن واقعی، موجودی و History تغییر نمی‌کنند.</div>
    <div class="whatif-controls">
      <label>معامله
        <select id="whatIfTradeSelect">${options}</select>
      </label>
      <label>نتیجه جایگزین
        <select id="whatIfResultSelect">
          <option value="W">Win</option>
          <option value="BE">BE</option>
          <option value="L">Loss</option>
        </select>
      </label>
      <button id="whatIfRunBtn" class="btn btn-primary" type="button">مقایسه</button>
    </div>
    <div id="whatIfResult" class="whatif-result"></div>`;
  const selected=Number(document.getElementById('whatIfTradeSelect')?.value || 0);
  document.getElementById('whatIfResultSelect').value = actual[selected] === 'W' ? 'L' : actual[selected] === 'L' ? 'W' : 'W';
  document.getElementById('whatIfRunBtn')?.addEventListener('click', runWhatIfComparison);
  runWhatIfComparison();
}

function runWhatIfComparison(){
  const plan=getWhatIfPlan();
  const target=getUnifiedTarget();
  const tradeSelect=document.getElementById('whatIfTradeSelect');
  const resultSelect=document.getElementById('whatIfResultSelect');
  const body=document.getElementById('whatIfResult');
  if(!plan || !tradeSelect || !resultSelect || !body) return;
  const actual=trades.map(t=>t.result).filter(Boolean);
  const index=Number(tradeSelect.value);
  const hypothetical=parseScenario(actual);
  hypothetical[index]=resultSelect.value;
  const comparison=buildWhatIfComparison({
    mode,
    capital:num('initialCapital'),
    payout:getValidPayout(),
    targetProfit:target.targetProfit,
    targetBalance:target.targetBalance,
    stopLossBalance:getStopLossBalance(),
    plan,
    actualResults:actual,
    hypotheticalResults:hypothetical,
    minStake:MIN_STAKE
  });
  if(!comparison.valid){
    body.innerHTML=`<div class="scenario-error">⚠ ${comparison.reason || 'مقایسه انجام نشد.'}</div>`;
    return;
  }
  const signed=v=>(v>0?'+':'')+money(v);
  const deltaClass=comparison.delta.finalBalance >= 0 ? 'pos' : 'neg';
  const reasonText={target:'Target',stoploss:'Stop Loss','plan-complete':'پایان برنامه','target-impossible':'هدف غیرممکن','no-trades-left':'پایان معاملات','insufficient-balance':'موجودی ناکافی'};
  const row=(label,a,b,format='money')=>`<div><span>${label}</span><b>${format==='money'?money(a):a}</b><b>${format==='money'?money(b):b}</b></div>`;
  body.innerHTML=`
    <div class="whatif-legend"><span></span><b>واقعی</b><b>اگر ${hypothetical[index]} می‌شد</b></div>
    <div class="whatif-summary">
      ${row('موجودی نهایی',comparison.actual.finalBalance,comparison.hypothetical.finalBalance)}
      ${row('Profit',comparison.actual.profit,comparison.hypothetical.profit)}
      ${row('معاملات',comparison.actual.trades,comparison.hypothetical.trades,'number')}
      ${row('Win / BE / Loss',`${comparison.actual.wins} / ${comparison.actual.breakevens} / ${comparison.actual.losses}`,`${comparison.hypothetical.wins} / ${comparison.hypothetical.breakevens} / ${comparison.hypothetical.losses}`,'text')}
      ${row('Max Drawdown',comparison.actual.maxDrawdown,comparison.hypothetical.maxDrawdown)}
    </div>
    <div class="whatif-delta ${deltaClass}">تغییر موجودی نهایی: <strong>${signed(comparison.delta.finalBalance)}</strong></div>
    <div class="whatif-status">
      <div>واقعی: <b>${comparison.actual.locked ? (reasonText[comparison.actual.lockReason] || comparison.actual.lockReason) : 'ادامه‌پذیر'}</b></div>
      <div>فرضی: <b>${comparison.hypothetical.locked ? (reasonText[comparison.hypothetical.lockReason] || comparison.hypothetical.lockReason) : 'ادامه‌پذیر'}</b></div>
    </div>
    <div class="whatif-note">فقط نتیجه معامله ${index+1} تغییر داده شده است؛ تمام معاملات بعدی با موتور واقعی ${mode === 'simple' ? 'Simple' : 'Masaniello'} دوباره محاسبه شده‌اند.</div>`;
}


function openScenarioSimulator(){
  const plan = getScenarioPlan();
  if(!plan || plan.valid === false){
    showAppMessage('ابتدا یک برنامه معتبر بسازید تا سناریو قابل شبیه‌سازی باشد.', 'شبیه‌ساز سناریو');
    return;
  }
  const modal = document.getElementById('scenarioSimulatorModal');
  const input = document.getElementById('scenarioInput');
  if(!modal || !input) return;
  input.value = input.value || 'W → L → BE → L → W';
  renderScenarioSimulation();
  modal.classList.add('show');
  modal.setAttribute('aria-hidden','false');
  setTimeout(() => input.focus(), 0);
}

function closeScenarioSimulator(){
  const modal = document.getElementById('scenarioSimulatorModal');
  if(!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden','true');
}

function appendScenarioResult(result){
  const input = document.getElementById('scenarioInput');
  if(!input) return;
  const values = parseScenario(input.value);
  values.push(result);
  input.value = values.join(' → ');
  renderScenarioSimulation();
}

function clearScenarioInput(){
  const input = document.getElementById('scenarioInput');
  if(input) input.value = '';
  renderScenarioSimulation();
}

function renderScenarioSimulation(){
  const plan = getScenarioPlan();
  const input = document.getElementById('scenarioInput');
  const body = document.getElementById('scenarioSimulatorBody');
  if(!plan || !input || !body) return;
  const target = getUnifiedTarget();
  const result = simulateScenario({
    mode,
    capital: num('initialCapital'),
    payout: getValidPayout(),
    targetProfit: target.targetProfit,
    stopLossBalance: getStopLossBalance(),
    plan,
    results: input.value,
    minStake: MIN_STAKE
  });
  if(!result.valid){
    body.innerHTML = `<div class="scenario-error">⚠ ورودی سناریو نامعتبر است. فقط W، BE و L مجاز هستند.</div>`;
    return;
  }
  const signed = v => (v > 0 ? '+' : '') + money(v);
  const reasonText = {
    target:'Target',
    stoploss:'Stop Loss',
    'plan-complete':'پایان برنامه',
    'no-trades-left':'پایان معاملات',
    'target-impossible':'هدف غیرممکن',
    'insufficient-balance':'موجودی ناکافی',
    'invalid-payout':'Payout نامعتبر'
  };
  const rows = result.rows.length ? result.rows.map(r => `
    <div class="scenario-row ${r.executed ? '' : 'not-executed'}">
      <b>${r.no}</b><strong>${r.result}</strong>
      <span>${r.executed ? money(r.stake) : '—'}</span>
      <span>${money(r.balance)}</span>
      <span class="${r.profit < 0 ? 'neg' : 'pos'}">${signed(r.profit)}</span>
    </div>`).join('') : '<div class="small-center small">سناریویی وارد نشده است.</div>';
  body.innerHTML = `
    <div class="scenario-controls">
      <button class="btn btnW" data-scenario-result="W" type="button">Win</button>
      <button class="btn btnBE" data-scenario-result="BE" type="button">BE</button>
      <button class="btn btnL" data-scenario-result="L" type="button">Loss</button>
      <button class="btn btn-secondary" id="scenarioClearBtn" type="button">پاک کردن</button>
    </div>
    <input id="scenarioInput" class="scenario-input" value="${input.value.replace(/"/g,'&quot;')}" aria-label="نتایج سناریو" placeholder="W → L → BE → L → W">
    <div class="scenario-summary">
      <div><span>معاملات</span><b>${result.trades}</b></div>
      <div><span>Win / BE / Loss</span><b>${result.wins} / ${result.breakevens} / ${result.losses}</b></div>
      <div><span>موجودی نهایی</span><b>${money(result.finalBalance)}</b></div>
      <div><span>Profit</span><b>${signed(result.profit)}</b></div>
      <div><span>Win Rate</span><b>${result.winRate.toFixed(1)}%</b></div>
      <div><span>Max Drawdown</span><b>${money(result.maxDrawdown)}</b></div>
      <div><span>Max Loss Streak</span><b>${result.maxLossStreak}</b></div>
      <div><span>وضعیت</span><b>${result.locked ? (reasonText[result.lockReason] || result.lockReason) : 'ادامه‌پذیر'}</b></div>
    </div>
    <div class="scenario-table">
      <div class="scenario-row scenario-head"><b>#</b><b>نتیجه</b><b>Stake</b><b>Balance</b><b>Profit</b></div>
      ${rows}
    </div>`;
  body.querySelectorAll('[data-scenario-result]').forEach(btn => {
    btn.addEventListener('click', () => appendScenarioResult(btn.dataset.scenarioResult));
  });
  body.querySelector('#scenarioClearBtn')?.addEventListener('click', clearScenarioInput);
  body.querySelector('#scenarioInput')?.addEventListener('input', event => {
    input.value = event.target.value;
    renderScenarioSimulation();
  });
}

function closePlanAnalyzer(){
  const modal=document.getElementById('planAnalyzerModal');
  if(!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden','true');
}

/* renderTradingPlanGoal() — the missing display layer for the Phase 5
   long-term Trading Plan feature. computeTradingPlanStats() and the
   create/edit form handlers already existed; only this render step
   (deciding which view to show and filling in the numbers) was gone,
   which is why #tradingPlanActiveView/#tradingPlanCreateView never
   updated. Purely a display pass — no state is written here. */
function renderTradingPlanGoal(){
  const createView = document.getElementById('tradingPlanCreateView');
  const activeView = document.getElementById('tradingPlanActiveView');
  if(!createView || !activeView) return;
  const hasRunning = !!tradingPlan && tradingPlan.status === 'running';
  const showCreate = !hasRunning || tradingPlanFormMode === 'edit';
  createView.classList.toggle('hidden', !showCreate);
  activeView.classList.toggle('hidden', showCreate);
  if(!hasRunning || showCreate) return;

  const stats = computeTradingPlanStats();
  document.getElementById('tpActiveName').textContent = tradingPlan.planName || 'برنامه بدون‌نام';
  document.getElementById('tpActiveTarget').textContent = money(tradingPlan.targetBalance);
  document.getElementById('tpActiveProgress').textContent = stats.progressPercent!==null ? stats.progressPercent.toFixed(1)+'%' : '-';
  document.getElementById('tpActiveRemaining').textContent = stats.remainingProfit!==null ? money(stats.remainingProfit) : '-';
  document.getElementById('tpActiveSessions').textContent = stats.sessionsCompletedTowardPlan;
  document.getElementById('tpActiveAvgProfit').textContent = stats.averageProfitPerCompletedSession!==null ? money(stats.averageProfitPerCompletedSession) : '-';
  document.getElementById('tpActiveEstRemaining').textContent = stats.estimatedSessionsRemaining!==null ? Math.max(0,Math.ceil(stats.estimatedSessionsRemaining)) : '-';
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
  const pauseTop=document.getElementById('pauseTopBtn');
  const active=trades.length>0 && !sessionPaused;
  pause?.classList.toggle('hidden',!active);
  pauseTop?.classList.toggle('hidden',!active);
  resume?.classList.toggle('hidden',!sessionPaused || trades.length===0);
  start?.classList.toggle('hidden',active || sessionPaused);
}

// Renders the three selectable Masaniello risk-plan cards, mirroring
// renderSimplePlanner()'s UI for parity between the two modes. Purely a
// display/selection layer over the existing buildMasanielloPlans() —
// no Masaniello math lives here.
function renderMasanielloPlannerCards(){
  const wrap=document.getElementById('masanielloPlannerOptions'); if(!wrap) return;
  const plans=buildMasanielloPlans(num('initialCapital'),getPayoutPercent(),getUnifiedTarget().targetProfit,MIN_STAKE);
  const labels={low:'کم‌ریسک',medium:'ریسک متوسط',high:'پرریسک'};
  wrap.innerHTML=plans.map(o=>{
    const selected=selectedPlannerRisk===o.risk;
    if(!o.valid) return `<button type="button" class="tp-risk-card disabled"><div class="tp-risk-title">${labels[o.risk]}</div><div>با ورودی فعلی قابل اجرا نیست</div></button>`;
    return `<button type="button" class="tp-risk-card selectable risk-${o.risk} ${selected?'selected':''}" data-simple-risk="${o.risk}">
      <div class="tp-risk-title">${labels[o.risk]}</div>
      <div><b>${o.n}</b><span> معامله</span></div>
      <div><b>${o.k}</b><span> برد لازم</span></div>
      <div><b>${o.losses}</b><span> باخت مجاز</span></div>
      <div><b>${money(o.targetBalance)}</b><span> هدف نهایی</span></div>
      <div><b>${money(o.worstCaseFinal)}</b><span> نتیجه تضمینی</span></div>
    </button>`;
  }).join('');
  wrap.querySelectorAll('[data-simple-risk]').forEach(btn=>btn.addEventListener('click',()=>selectPlannerRisk(btn.dataset.simpleRisk)));
  const info=document.getElementById('masanielloPlannerInfo');
  if(info){
    const p=plans.find(x=>x.risk===selectedPlannerRisk && x.valid);
    info.textContent=p ? `برنامه انتخاب‌شده: ${p.n} معامله، ${p.k} برد لازم و ${p.losses} باخت مجاز. نتیجه تضمینی: ${money(p.worstCaseFinal)}.` : 'یک برنامه را انتخاب کنید.';
  }
}

function renderMasanielloPlanner(summary){
  renderMasanielloPlannerCards();
  const plans=buildMasanielloPlans(num('initialCapital'),getPayoutPercent(),getUnifiedTarget().targetProfit,MIN_STAKE);
  const labels={low:'کم‌ریسک',medium:'ریسک متوسط',high:'پرریسک'};
  const current=selectedPlannerPlan || plans.find(p=>p.risk===selectedPlannerRisk) || plans.find(p=>p.risk==='medium');
  if(current?.valid){
    selectedPlannerPlan=current;
    const losses=current.n-current.k;
    summary.innerHTML=`<b>${labels[current.risk]||'Custom'}</b> · ${current.n} معامله · ${current.k} برد · ${losses} باخت مجاز<br><span class="small">هدف نهایی: ${money(current.targetBalance)} · نتیجه تضمینی: ${money(current.worstCaseFinal)}</span>`;
  }else summary.textContent='با ورودی‌های فعلی برنامه قابل محاسبه نیست.';
}

function renderSimplePlannerSummary(summary){
  const plans=buildSimplePlans(num('initialCapital'),getPayoutPercent(),getWinProfitAmount(),MIN_STAKE,getStopLossBalance());
  const current=selectedPlannerPlan || plans.find(p=>p.risk===selectedPlannerRisk) || plans.find(p=>p.risk==='medium');
  if(current?.valid){
    selectedPlannerPlan=current;
    summary.innerHTML=`<b>${current.label}</b> · ${current.n} معامله · ${current.k} برد هدف · ${current.n-current.k} باخت مجاز<br><span class="small">سود هدف هر برد: ${money(current.profitPerWin)} · بیشترین Stake: ${money(current.maxStake)} · بودجه SL: ${money(current.stopLossAmount)}</span>`;
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
    payoutPercent: getPayoutPercent(),
    riskOptions: computeTradingPlanRiskOptions(planStartBalance, resolved.targetBalance, getPayoutPercent()),
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
  tradingPlan.payoutPercent = getPayoutPercent();
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
  const options = mode === 'masaniello' ? buildMasanielloPlans(num('initialCapital'),getPayoutPercent(),getUnifiedTarget().targetProfit,MIN_STAKE) : buildSimplePlans(num('initialCapital'),getPayoutPercent(),getWinProfitAmount(),MIN_STAKE,getStopLossBalance());
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
    const planStartBalance = num('tpFormStartBalance');
    if(!Number.isFinite(planStartBalance)){
      await showAppMessage('موجودی شروع برنامه را وارد کنید.', 'اطلاعات ناقص');
      return;
    }
    createTradingPlan(planName, planStartBalance, targetPercent, targetBalance);
  }

  saveState();
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

  document.getElementById('tpFormStartBalance').value = formatNumber(tradingPlan.planStartBalance);
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
  saveState();
  render();
  clearTradingPlanForm();
}

async function onTradingPlanCancel(){
  if(!await showAppConfirm('این برنامه لغو شود؟', 'لغو برنامه')) return;
  cancelTradingPlan();
  saveState();
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
    payout_percent: getPayoutPercent(),
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
    tbody.innerHTML = trades.map(t => {
      // t.result must be strictly one of these three known values before it is
      // ever used as a CSS class or badge label — a restored Backup file could
      // otherwise put an attribute-breaking string here (e.g. `"><script>`).
      const result = (t.result === 'W' || t.result === 'BE' || t.result === 'L') ? t.result : 'L';
      const rowClass = result === 'W' ? 'rowW' : (result === 'BE' ? 'rowBE' : 'rowL');
      return `
      <tr class="${rowClass}">
        <td>${escapeHtml(t.no)}</td>
        <td><span class="badge ${result}">${result}</span></td>
        <td>${money(t.amount)}</td>
        <td class="${t.ret < 0 ? 'neg' : 'pos'}">${money(t.ret)}</td>
        <td>${money(t.balance)}</td>
      </tr>
    `;
    }).join('');
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
  renderTradingPlanGoal();

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
    explainEl.classList.remove('hidden');
  } else {
    explainEl.innerHTML = '';
    explainEl.classList.add('hidden');
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
  tradingPlan={id:generatePlanId(),enabled:true,planName:`${mode==='masaniello'?'Masaniello':'Simple'} ${selectedPlannerPlan.risk==='custom'?'Custom':(selectedPlannerPlan.label||selectedPlannerPlan.risk)}`,planStartBalance:capital,targetPercent:percent,targetBalance,payoutPercent:getPayoutPercent(),selectedPlan:selectedPlannerPlan,mode,planCreatedAt:new Date().toISOString(),status:'running'};
  saveState(); render();
}

function bindUI(){
  const $ = id => document.getElementById(id);
  $('modeBtnSimple')?.addEventListener('click', () => setMode('simple'));
  $('modeBtnMasaniello')?.addEventListener('click', () => setMode('masaniello'));
  document.querySelectorAll('[data-section-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchSectionTab(btn.dataset.sectionTab));
  });
  $('riskAdvisorToggle')?.addEventListener('click', () => {
    const strip = $('riskAdvisorStrip');
    const toggle = $('riskAdvisorToggle');
    const willShow = strip.classList.contains('hidden');
    strip.classList.toggle('hidden', !willShow);
    toggle.setAttribute('aria-expanded', String(willShow));
  });
  $('tpFormStartBalance')?.addEventListener('blur', () => {
    const el = $('tpFormStartBalance');
    const v = parseFloat((el.value || '').replace(/,/g,''));
    if(Number.isFinite(v) && v > 0) el.value = formatNumber(v);
  });
  $('stopLossAlertPct')?.addEventListener('input', render);
  $('t-sessionEnd')?.addEventListener('click', () => toggleBtn('t-sessionEnd'));
  $('t-lowTrade')?.addEventListener('click', () => toggleBtn('t-lowTrade'));
  $('t-autoCopy')?.addEventListener('click', () => toggleBtn('t-autoCopy'));
  $('resetSessionCounterBtn')?.addEventListener('click', resetSessionCounter);
  $('aboutBtn')?.addEventListener('click', showAbout);
  $('analyzePlanBtn')?.addEventListener('click', openPlanAnalyzer);
  $('scenarioSimulatorBtn')?.addEventListener('click', openScenarioSimulator);
  $('stressTestingBtn')?.addEventListener('click', openStressTesting);
  $('strategyComparisonBtn')?.addEventListener('click', openStrategyComparison);
  $('whatIfBtn')?.addEventListener('click', openWhatIfLab);
  $('whatIfCloseBtn')?.addEventListener('click', closeWhatIfLab);
  $('whatIfModal')?.addEventListener('click', event => { if(event.target === event.currentTarget) closeWhatIfLab(); });
  $('scenarioSimulatorCloseBtn')?.addEventListener('click', closeScenarioSimulator);
  $('scenarioSimulatorModal')?.addEventListener('click', event => { if(event.target === event.currentTarget) closeScenarioSimulator(); });
  $('stressTestingCloseBtn')?.addEventListener('click', closeStressTesting);
  $('stressTestingModal')?.addEventListener('click', event => { if(event.target === event.currentTarget) closeStressTesting(); });
  $('strategyComparisonCloseBtn')?.addEventListener('click', closeStrategyComparison);
  $('strategyComparisonModal')?.addEventListener('click', event => { if(event.target === event.currentTarget) closeStrategyComparison(); });
  $('planAnalyzerCloseBtn')?.addEventListener('click', closePlanAnalyzer);
  $('planAnalyzerModal')?.addEventListener('click', event => { if(event.target === event.currentTarget) closePlanAnalyzer(); });
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

  document.querySelectorAll('input[name="tpTargetType"]').forEach(input => input.addEventListener('change', onTradingPlanTargetTypeChange));
  const planCreateButton = $('tradingPlanCreateView')?.querySelector('.subactions .btn');
  planCreateButton?.addEventListener('click', onTradingPlanFormSubmit);

  $('tpEditBtn')?.addEventListener('click', onTradingPlanEdit);
  $('tpCompleteBtn')?.addEventListener('click', onTradingPlanComplete);
  $('tpCancelBtn')?.addEventListener('click', onTradingPlanCancel);

  $('historyExportBtn')?.addEventListener('click', exportHistoryCSV);
  $('historyClearBtn')?.addEventListener('click', clearHistory);
  document.querySelector('.logbtn')?.addEventListener('click', toggleLog);
  $('backupExportBtn')?.addEventListener('click', exportBackup);
  $('backupImportBtn')?.addEventListener('click', () => $('backupImportInput')?.click());
  $('backupImportInput')?.addEventListener('change', handleBackupImport);
  $('copyBtn')?.addEventListener('click', copyLog);
}

function applyNativeTheme(){
  try{
    const native = window.Capacitor?.Plugins?.SystemBars;
    if(!native) return;

    native.setStyle?.({style:'DARK'});

    /*
     * Android fullscreen contract:
     * - System bars start hidden.
     * - Android may temporarily reveal them after a system gesture.
     * - Once the user stops interacting, hide them again.
     *
     * Safe-area CSS is used only for layout. It is deliberately NOT
     * used as the source of truth for system-bar visibility.
     */
    const HIDE_DELAY_MS = 2500;
    let hideTimer = null;

    const hideBars = () => {
      try{
        native.hide?.();
      }catch(_){}
      document.documentElement.classList.remove('system-bars-visible');
    };

    const scheduleHide = () => {
      if(hideTimer) clearTimeout(hideTimer);

      hideTimer = setTimeout(() => {
        hideTimer = null;
        hideBars();
      }, HIDE_DELAY_MS);
    };

    /*
     * Normal interaction means the user is still using the screen.
     * Restart the quiet-period timer rather than hiding bars immediately.
     */
    [
      'pointerdown',
      'touchstart',
      'wheel',
      'scroll'
    ].forEach(type => {
      window.addEventListener(type, scheduleHide, {
        passive:true,
        capture:type === 'scroll'
      });
    });

    /*
     * A system-bar gesture changes the visual viewport on Android.
     * We do not infer visibility from safe-area CSS variables because
     * those variables are layout geometry, not a visibility signal.
     */
    let lastViewportHeight =
      window.visualViewport?.height ?? window.innerHeight;

    const detectViewportChange = () => {
      const height =
        window.visualViewport?.height ?? window.innerHeight;

      if(Math.abs(height - lastViewportHeight) > 1){
        const previousHeight = lastViewportHeight;
        lastViewportHeight = height;

        /*
         * A significant viewport-height change indicates that Android
         * temporarily revealed or hid its system UI.
         */
        if(height < previousHeight - 1){
          document.documentElement.classList.add('system-bars-visible');
        }

        scheduleHide();
      }
    };

    window.addEventListener('resize', detectViewportChange, {
      passive:true
    });

    window.visualViewport?.addEventListener(
      'resize',
      detectViewportChange,
      {passive:true}
    );

    hideBars();
  }catch(_){
    /* web/PWA has no native SystemBars plugin */
  }
}
/* =====================================================
   INITIALIZATION
===================================================== */

bindUI();
restoreUiDisclosures();
applyNativeTheme();

const restored = loadState();
if(!restored){
  document.getElementById('modeBtnSimple').classList.add('active');
  formatCapitalInput();
  applySetup();
}
syncUnifiedTarget();
if(!selectedPlannerRisk) selectedPlannerRisk='medium';
render();
renderRiskAdvisor();
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

// Close the manual options menu when tapping anywhere outside it.
// Native <details> still handles its own open/close state.
(() => {
  const menu = document.getElementById('optionsMenu');
  if(!menu) return;
  const closeFromOutside = event => {
    if(menu.open && !menu.contains(event.target)) menu.open = false;
  };
  document.addEventListener('pointerdown', closeFromOutside, {passive:true});
  document.getElementById('menuBackdrop')?.addEventListener('click', () => { menu.open = false; });
  document.addEventListener('keydown', event => {
    if(event.key === 'Escape' && menu.open){
      menu.open = false;
      menu.querySelector('summary')?.focus();
    }
  });
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


document.getElementById('payout')?.addEventListener('blur',()=>{ normalizePayoutField(); validateSetupInputs({showMessage:false}); });

/* =====================================================
   PWA — Service Worker registration (AUDIT finding #11)
   Registers the existing service-worker.js so the offline/PWA
   caching strategy it already implements actually runs. Only for
   the web build served over http(s); the packaged native app is
   offline-only via its bundled assets and doesn't need this layer,
   so it's skipped there to avoid changing native behavior.
===================================================== */
if('serviceWorker' in navigator && !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}
