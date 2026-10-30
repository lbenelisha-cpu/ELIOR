import {planResearchTrade} from './lib/trader-planner.mjs';
const $ = id => document.getElementById(id);
const number = (v, digits = 2) => Number.isFinite(v) ? v.toLocaleString('he-IL', {maximumFractionDigits: digits}) : '—';
const timestamp = v => Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleString('he-IL', {timeZone: 'Asia/Jerusalem'}) : '—';
const add = (tag, text, parent) => {const el = document.createElement(tag); el.textContent = text; parent.append(el); return el;};
let current = null;

function renderFinancials() {
  const host = $('financialTable'); host.replaceChildren();
  if (!current) return;
  const rows = current.periods[$('period').value] || [];
  if (!rows.length) {add('p', 'אין תקופות מדווחות מתאימות בדולר במקור זה. אפשר לבדוק תצוגה שנתית או לפתוח את הדוח המקורי.', host); return;}
  const wrap = add('div', '', host); wrap.className = 'table-wrap';
  const table = add('table', '', wrap), caption = add('caption', 'נתונים מדווחים · USD', table);
  caption.className = 'hint';
  const head = add('tr', '', add('thead', '', table)), body = add('tbody', '', table);
  for (const label of ['תקופה', 'הכנסות במיליונים', 'שינוי שנתי', 'רווח נקי במיליונים', 'רווח מדולל למניה']) {const th = add('th', label, head); th.scope = 'col';}
  const metric = (row, value, divisor = 1) => {const td = add('td', value ? number(value.value / divisor) : '—', row); if (value) add('small', 'הוגש ' + value.filed, td);};
  for (const row of rows) {
    const tr = add('tr', '', body), period = add('td', row.end, tr); add('small', 'מ־' + row.start, period);
    metric(tr, row.revenue, 1e6);
    add('td', Number.isFinite(row.revenueGrowthPct) ? number(row.revenueGrowthPct) + '%' : '—', tr);
    metric(tr, row.netIncome, 1e6); metric(tr, row.eps);
  }
}

function resetReport() {
  current = null; $('companyReport').hidden = true; $('financialTable').replaceChildren(); $('headlines').replaceChildren();
  $('companyName').textContent = ''; $('financialStatus').textContent = ''; $('newsStatus').textContent = 'טוען כותרות…';
}
$('period').addEventListener('change', renderFinancials);
$('researchForm').addEventListener('submit', async event => {
  event.preventDefault(); if ($('researchButton').disabled) return;
  const symbol = $('symbol').value.trim().toUpperCase().replace('-', '.');
  resetReport(); $('researchButton').disabled = true; $('researchButton').textContent = 'בודק…';
  $('researchStatus').textContent = 'מחפש מידע על ' + symbol + '…';
  try {
    const response = await fetch('/.netlify/functions/trader-research?symbol=' + encodeURIComponent(symbol), {signal: AbortSignal.timeout(12000), credentials: 'omit'});
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'RESEARCH_UNAVAILABLE');
    if (data.symbol !== symbol || data.version !== 'TRADER_RESEARCH_V1') throw Error('RESEARCH_UNAVAILABLE');
    $('researchStatus').textContent = symbol + ' · בדיקת מקורות: ' + timestamp(data.fetchedAt) + (data.cached ? ' · עותק שמור' : '') + ' · תאריכי הדיווחים והכתבות מוצגים ליד הנתונים.';
    $('companyReport').hidden = false;
    current = data.financials.data;
    $('companyName').textContent = current?.company || symbol;
    $('secLink').hidden = !current;
    if (current) $('secLink').href = 'https://www.sec.gov/edgar/browse/?CIK=' + encodeURIComponent(current.cik);
    const messages = {OK: 'מקור: SEC EDGAR. רבעונים ושנים מדווחים בנפרד; שינוי שנתי מחושב רק מול תקופה מקבילה באותו מדד.', CONFIG_REQUIRED: 'דוחות SEC טרם הופעלו בשרת. החדשות והמחשבון זמינים בנפרד.', NOT_COVERED: 'לא נמצאו נתונים מדווחים מתאימים למניה זו במקור SEC. זה אינו סימן לחולשה עסקית.', UNAVAILABLE: 'מקור הדוחות אינו זמין כרגע. אין נתונים מאומתים להצגה.'};
    $('financialStatus').textContent = messages[data.financials.status] || messages.UNAVAILABLE;
    if (current) renderFinancials();
    const news = data.news.status === 'OK' && Array.isArray(data.news.data) ? data.news.data : [];
    $('newsStatus').textContent = data.news.status !== 'OK' ? 'מקור החדשות אינו זמין כרגע. אי אפשר להסיק שלא היו חדשות.' : news.length ? 'Yahoo Finance RSS · עד 12 כותרות משבעת הימים האחרונים' : 'לא נמצאו כותרות מתוארכות מהשבוע האחרון בפיד. אין בכך אישור שלא פורסמו חדשות.';
    for (const item of news) {
      let url; try {url = new URL(item.url);} catch {continue;}
      if (url.protocol !== 'https:' || url.username || url.password) continue;
      const li = add('li', '', $('headlines')), link = add('a', item.title, li);
      link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      add('small', timestamp(item.publishedAt) + ' · ' + item.source, li);
    }
  } catch (error) {
    $('researchStatus').textContent = error.message === 'INVALID_SYMBOL' ? 'יש להזין סימול תקין של מניה אמריקאית.' : error.message === 'RESEARCH_BUSY' ? 'מתבצעות כרגע בדיקות אחרות. נסה שוב בעוד מספר שניות.' : 'לא ניתן להשלים את הבדיקה כרגע. נסה שוב מאוחר יותר.';
    $('newsStatus').textContent = 'לא נטענו חדשות מאומתות.';
  } finally { $('researchButton').disabled = false; $('researchButton').textContent = 'בדוק מניה'; }
});
$('plannerForm').addEventListener('input', () => {$('planResult').hidden = true;});
$('plannerForm').addEventListener('submit', event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  values.wholeShares = event.currentTarget.elements.wholeShares.checked;
  values.alreadyHeld = event.currentTarget.elements.alreadyHeld.checked;
  const plan = planResearchTrade(values), host = $('planResult'); host.replaceChildren(); host.hidden = false; host.className = 'plan-result' + (plan.ok ? '' : ' error');
  if (!plan.ok) {add('p', 'התרחיש אינו עומד בתנאים', host); const ul = add('ul', '', host); plan.reasons.forEach(reason => add('li', reason, ul)); return;}
  add('p', 'גודל עסקה המחושב לפי הנתונים שהזנת', host);
  const dl = add('dl', '', host);
  for (const [label, value] of [['סכום העסקה', number(plan.notional)], ['כמות יחידות', number(plan.quantity, 8)], ['הפסד משוער בסטופ כולל עלויות', number(plan.estimatedLoss)], ['הפסד משוער מהתיק', number(plan.estimatedLossPct) + '%'], ['עלויות משוערות', number(plan.estimatedCosts)], ['מזומן לאחר עתודת עלויות', number(plan.cashAfterCostReserve)]]) {const group = add('div', '', dl); add('dt', label, group); add('dd', value, group);}
  add('small', 'ההקצאה חושבה לפי הנמוך מבין מגבלת 20%, המזומן ותקציב ההפסד שהזנת. זהו תכנון בלבד; לא נוצרה פקודה ולא עודכנו הגדרות המסחר.', host);
});
