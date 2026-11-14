import { parseStockAlert, mergeStockAlert } from './stock-alert-plan.js';
import { initManagedProtection } from './stock-managed-protection.js';

const $ = id => document.getElementById(id);
const endpoint = '/.netlify/functions/stock-plan-inbox';
const deviceKey = 'levi-colmex-device-v1';
const savedKey = 'levi-stock-alerts-v1';
const format = new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 });
const usd = value => '$' + format.format(value);
function readLocal(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function savedPlans() {
  try {
    const messages = JSON.parse(readLocal(savedKey) || '[]');
    if (!Array.isArray(messages)) return [];
    return messages.slice(0, 50).reduce((items, raw) => {
      const plan = parseStockAlert(raw);
      return plan ? mergeStockAlert(items, { ...plan, raw }) : items;
    }, []);
  } catch { return []; }
}

let device = readLocal(deviceKey);
let localPlans = savedPlans();
let remotePlans = [];
let loading = false;
function showAccess() {
  $('pairForm').hidden = Boolean(device);
  $('getWebhook').hidden = !device;
}
function valueRow(list, label, value) {
  const group = document.createElement('div');
  const name = document.createElement('dt');
  const data = document.createElement('dd');
  name.textContent = label;
  data.textContent = value;
  group.append(name, data);
  list.append(group);
}
function renderPlans() {
  const items = localPlans.reduce(mergeStockAlert, remotePlans);
  const host = $('plans');
  host.replaceChildren();
  for (const plan of items) {
    const card = document.createElement('article');
    const title = document.createElement('h3');
    title.dir = 'ltr';
    title.textContent = plan.symbol + ' · ' + plan.side;
    const when = document.createElement('p');
    when.textContent = 'האיתות האחרון שנשמר למניה · ' + plan.barTime + ' (ניו יורק)' + (plan.raw ? ' · הועתק במכשיר' : ' · התקבל בשרת');
    const levels = document.createElement('dl');
    valueRow(levels, 'מחיר ייחוס בסגירת הנר', usd(plan.reference));
    valueRow(levels, 'סטופ־לוס התחלתי', usd(plan.stop) + ' · ' + format.format(plan.stopPct) + '%');
    valueRow(levels, 'יעד רווח', usd(plan.target) + ' · ' + format.format(plan.targetPct) + '%');
    valueRow(levels, 'הפעלת הגנה לפי 5 גלים', usd(plan.activation) + ' · ' + format.format(plan.activationPct) + '%');
    const edge = plan.side === 'SHORT' ? 'מעל השפל' : 'מתחת לשיא';
    valueRow(levels, 'מרחק הסטופ אחרי ההפעלה', usd(plan.trail) + ' ' + edge + ' · ' + format.format(plan.trailPp) + ' נק׳ אחוז ממחיר הייחוס');
    const status = document.createElement('p');
    status.textContent = 'תכנון לפי האיתות. לאחר ביצוע ידני יש להתאים את הרמות למחיר המילוי ולבדוק את הוראות ההגנה בברוקר.';
    card.append(title, when, levels, status);
    host.append(card);
  }
}
const header = () => ({ Authorization: 'Bearer ' + device });
async function loadInbox() {
  if (loading) return;
  if (!device) {
    $('inboxStatus').textContent = 'אפשר להדביק הודעת LEVI קיימת, או לחבר את ההתראה לקבלת האיתותים הבאים.';
    return;
  }
  loading = true;
  try {
    const response = await fetch(endpoint, { headers: header(), cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (response.status === 401) {
      device = null;
      remotePlans = [];
      $('webhookValue').value = '';
      $('webhookValue').hidden = true;
      showAccess();
      renderPlans();
      $('inboxStatus').textContent = 'האימות של המכשיר לא התקבל. בדוק את החיבור ב״חיבור התראות״.';
      return;
    }
    if (!response.ok) throw Error();
    const data = await response.json();
    if (!Array.isArray(data.plans)) throw Error();
    remotePlans = data.plans;
    renderPlans();
    $('inboxStatus').textContent = remotePlans.length ? 'מוצג האיתות האחרון שהתקבל לכל מניה לפי מועד סגירת הנר.' :
      data.connected ? 'כתובת הקליטה מוכנה. טרם התקבל בה איתות מ־TradingView.' : 'טרם התקבלו איתותים בשרת. אפשר לחבר התראה או להדביק הודעה קיימת.';
  } catch {
    $('inboxStatus').textContent = 'לא ניתן לרענן כעת את האיתותים מהשרת. הודעות שכבר נטענו מוצגות עם זמן האיתות המקורי.';
  } finally { loading = false; }
}

$('pairForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('pairForm').querySelector('button');
  button.disabled = true;
  try {
    const response = await fetch('/.netlify/functions/colmex-device-access', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pair', code: $('pairCode').value }), signal: AbortSignal.timeout(15000)
    });
    const data = await response.json();
    if (!response.ok || !data.token) {
      $('setupStatus').textContent = ({ PAIR_CODE_INVALID: 'קוד החיבור שגוי.', PAIR_CODE_COOLDOWN: 'ניסיונות החיבור הושהו ל־15 דקות.' })[data.error] || 'חיבור המכשיר אינו זמין כרגע.';
      return;
    }
    device = data.token;
    $('pairCode').value = '';
    try { localStorage.setItem(deviceKey, device); } catch {}
    $('setupStatus').textContent = 'המכשיר מחובר. אפשר להעתיק את כתובת ההתראה.';
    showAccess();
    await loadInbox();
  } catch { $('setupStatus').textContent = 'לא התקבלה תשובה לחיבור המכשיר.'; }
  finally { button.disabled = false; }
});
$('getWebhook').addEventListener('click', async () => {
  $('getWebhook').disabled = true;
  const field = $('webhookValue');
  try {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { ...header(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'webhook' }), signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw Error();
    const { url } = await response.json();
    field.value = url;
    field.hidden = false;
    field.focus();
    field.select();
    try { await navigator.clipboard.writeText(url); $('setupStatus').textContent = 'הכתובת הועתקה. הדבק אותה בהתראת LEVI ב־TradingView ושמור את ההתראה.'; }
    catch { $('setupStatus').textContent = 'הכתובת מסומנת להעתקה ידנית.'; }
    loadInbox();
  } catch { $('setupStatus').textContent = 'כתובת ההתראה אינה זמינה כרגע. נסה לרענן את החיבור.'; }
  finally { $('getWebhook').disabled = false; }
});
$('importForm').addEventListener('submit', event => {
  event.preventDefault();
  const raw = $('alertText').value.trim();
  const plan = parseStockAlert(raw);
  if (!plan) {
    $('importStatus').textContent = 'ההודעה לא זוהתה. העתק את התראת LEVI המלאה, כולל רמות המחיר ומרחק הסטופ.';
    return;
  }
  localPlans = mergeStockAlert(mergeLocalStorage(), { ...plan, raw });
  let saved = true;
  try { localStorage.setItem(savedKey, JSON.stringify(localPlans.map(item => item.raw))); } catch { saved = false; }
  $('alertText').value = '';
  $('importStatus').textContent = saved ? 'התצוגה עודכנה לפי האיתות האחרון למניה השמור במכשיר.' : 'האיתות מוצג כעת. שמירה במכשיר אינה זמינה.';
  renderPlans();
});
function mergeLocalStorage() { return savedPlans().reduce(mergeStockAlert, localPlans); }

showAccess();
renderPlans();
initManagedProtection();
loadInbox();
window.addEventListener('storage', e => {
  if (e.key === savedKey) { localPlans = savedPlans(); renderPlans(); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadInbox(); });
setInterval(() => { if (!document.hidden && device) loadInbox(); }, 60000);
