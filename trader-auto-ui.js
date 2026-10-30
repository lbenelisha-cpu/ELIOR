const $ = id => document.getElementById(id);
const add = (tag, text, host, cls) => {const el = document.createElement(tag); el.textContent = text; if (cls) el.className = cls; host.append(el); return el;};
const num = (n, digits = 2) => Number.isFinite(n) ? n.toLocaleString('he-IL', {maximumFractionDigits: digits}) : '—';
const time = t => Number.isFinite(t) ? new Date(t).toLocaleString('he-IL', {timeZone: 'Asia/Jerusalem'}) : '—';
const reasons = {RUNNING: 'הסריקה פועלת', PARTIAL_DATA: 'חלק מנתוני השוק חסרים', MARKET_CLOSED: 'ממתין לפתיחת המסחר',
  CALENDAR_UNAVAILABLE: 'לוח המסחר אינו זמין', ENTRY_PAUSED: 'כניסות חדשות מושהות', WAIT_FIRST_SCAN: 'ממתין לסריקה ראשונה',
  STALE_MARKET_DATA: 'נתוני השוק ישנים — אין כניסה', MARKET_UNAVAILABLE: 'מקור המחירים אינו זמין או שמכסתו מוצתה',
  STOCK_SOURCE_NOT_CONFIGURED: 'מקור מחירי המניות טרם הוגדר', MARKET_RATE_LIMIT: 'מקור המחירים הגביל בקשות',
  INVALID_MARKET_DATA: 'נתוני השוק לא עברו אימות', MARKET_DATA_GAP: 'חסרים נרות בהיסטוריית המחירים',
  WAIT_MA_HISTORY: 'אין עדיין מספיק נרות לחישוב ממוצעים', WAIT_VOLUME_HISTORY: 'חסרה היסטוריית נפח מסחר',
  MA_DOWNTREND_BLOCK: 'המחיר מתחת לשני ממוצעים יורדים', CONFIRMATION_VOLUME_LOW: 'נפח האישור נמוך מדי',
  WAIT_ATR_HISTORY: 'אין מספיק נתונים למדידת תנודתיות', WAIT_CLOSED_CONFIRMATION: 'ממתין לאיתות מאושר בסגירת נר',
  WAIT_FRESH_PRICE: 'ממתין למחיר עדכני', WAIT_CURRENT_5M_BARS: 'ממתין לנר 5 דקות עדכני',
  WAIT_NEXT_CLOSED_BAR: 'איתות נמצא — ממתין לסגירה הבאה', SIGNAL_EXPIRED: 'תוקף האיתות פג',
  QUALITY_SIGNAL_INVALIDATED: 'מבנה האיתות נפסל לפני הכניסה', WAIT_RSI_0_40: 'תנאי RSI לכניסה לא מתקיים',
  QUALITY_FILTER_CHANGED: 'בדיקת הממוצעים, הנפח או התנודתיות לפני הכניסה נכשלה',
  VOLATILITY_RISK_TOO_HIGH: 'התנודתיות מחייבת סטופ גדול ממגבלת הדמו', MAX_POSITIONS: 'כל המקומות בתיק תפוסים',
  WAIT_PORTFOLIO_PRICES: 'ממתין לשערוך עדכני של הפוזיציות', INSUFFICIENT_PAPER_CASH: 'אין תקציב מדומה לכמות תקינה',
  INVALID_RISK_INPUT: 'נתוני הסיכון אינם מתאימים לכניסה', PAPER_BUY: 'בוצעה קנייה מדומה',
  SECOND_RECOVERY_NOT_HIGHER: 'שיא ההתאוששות השנייה אינו גבוה מהראשונה', WAIT_SECOND_RECOVERY_CONFIRMATION: 'ממתין לאישור ההתאוששות השנייה',
  TRAILING_PROFIT_EXIT: 'יציאה מדומה לפי ההגנה הנגררת', TRAILING_PROFIT_HOLD: 'החזקה עם הגנה נגררת',
  CYCLE_DEADLINE: 'הבדיקה נדחתה למחזור הבא', spring_reclaim_confirmed: 'Spring מאושר', early_wave_confirmed: 'פריצה מוקדמת מאושרת'};
function explain(reason) {
  if (reasons[reason]) return reasons[reason];
  if (/^WAIT_PROFIT_ACTIVATION_/.test(reason)) return 'החזקה — ממתין להפעלת ההגנה ברווח';
  if (/^TRAIL_STOP_LOSS_/.test(reason)) return 'יציאה מדומה לפי סטופ הפסד';
  if (/^PAPER_TAKE_PROFIT_/.test(reason)) return 'יציאה מדומה ביעד הרווח';
  return 'תנאי הכניסה עדיין לא הושלמו (' + reason + ')';
}
function table(host, headers, rows) {
  const wrap = add('div', '', host, 'table-wrap'), t = add('table', '', wrap), head = add('tr', '', add('thead', '', t));
  headers.forEach(text => {const th = add('th', text, head); th.scope = 'col';});
  const body = add('tbody', '', t);
  rows.forEach(row => {const tr = add('tr', '', body); row.forEach(value => add('td', value, tr));});
}
function context(host, data) {
  if (!data) return;
  const box = add('div', '', host, 'paper-context');
  const status = data.financials?.status;
  add('p', status === 'OK' ? 'דוחות SEC זמינים בהקשר האיתות; אפשר לבדוק אותם במחקר המניה בהמשך העמוד.' :
    status === 'NOT_APPLICABLE' ? 'דוחות SEC של חברות אינם רלוונטיים לנכס קריפטו זה.' :
    status === 'CONFIG_REQUIRED' ? 'דוחות SEC טרם הופעלו בשרת.' : 'דוחות SEC אינם זמינים בהקשר זה.', box, 'hint');
  if (data.news?.status !== 'OK') {add('p', 'חדשות לא נטענו בהקשר האיתות. אין בכך אישור שלא פורסמו חדשות.', box, 'hint'); return;}
  if (!data.news.data?.length) add('p', 'לא נמצאו כותרות מתוארכות בפיד מהשבוע האחרון.', box, 'hint');
  for (const news of (data.news.data || []).slice(0, 3)) {
    let url; try {url = new URL(news.url);} catch {continue;}
    if (url.protocol !== 'https:' || url.username || url.password) continue;
    const link = add('a', news.title, box); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    add('small', time(Date.parse(news.publishedAt)), box);
  }
}
function render(platform, now, enabled = false) {
  const card = add('article', '', $('autoCards'), 'paper-card');
  const heading = add('div', '', card, 'section-heading');
  add('h3', platform.platform === 'BINANCE' ? 'Binance · קריפטו' : 'Colmex Pro · מניות', heading);
  add('span', 'PAPER · ' + platform.currency, heading, 'badge');
  add('p', platform.symbols.join(' · '), card, 'paper-symbols');
  const state = platform.state;
  if (!state) {add('p', 'עדיין אין מחזור דמו שמור. הפעילות תוצג לאחר שהשרת ישלים את ההרצה הראשונה.', card); return;}
  const stale = now - state.lastCompletedAt > 15 * 60000;
  add('p', !enabled ? 'הדמו האוטומטי מושהה · מוצגים נתונים שמורים' : stale ? 'השרת לא עדכן את הדמו מעל 15 דקות — יש לבדוק את ההרצה.' : explain(state.status), card, 'paper-state' + (enabled && (stale || state.status === 'PARTIAL_DATA') ? ' attention' : ''));
  add('p', 'מחזור שמור אחרון: ' + time(state.lastCompletedAt) + ' · נתון שוק אחרון: ' + time(state.lastDataAt), card, 'hint');
  const dl = add('dl', '', card, 'paper-metrics'), summary = platform.summary;
  for (const [label, value] of [['שווי תיק מדומה', num(summary.equity)], ['מזומן מדומה', num(summary.cash)],
    ['רווח/הפסד מדומה', num(summary.pnl)], ['קניות / מכירות מדומות', summary.buys + ' / ' + summary.sells]]) {
    const group = add('div', '', dl); add('dt', label, group); add('dd', value, group);
  }
  add('p', 'השווי מבוסס על המחיר השמור לכל פוזיציה; ייתכן שאינו עדכני. רווח/הפסד כולל עלויות שכבר נרשמו, לפני עלות מכירה של פוזיציות פתוחות.', card, 'hint');
  const positions = Object.values(state.positions);
  add('h4', 'פוזיציות מדומות פתוחות (' + positions.length + ')', card);
  if (!positions.length) add('p', 'אין פוזיציות מדומות פתוחות.', card, 'hint');
  else table(card, ['נכס', 'כמות', 'כניסה', 'מחיר שמור', 'סטופ מדומה', 'זמן המחיר'], positions.map(p =>
    [p.symbol, num(p.quantity, 8), num(p.entryPrice, 6), num(p.lastPrice, 6), num(p.effectiveStopPrice, 6), time(p.priceAt)]));
  const pending = Object.entries(state.pending);
  if (pending.length) add('p', 'ממתינים לאישור כניסה בסגירה נוספת: ' + pending.map(([symbol]) => symbol).join(', '), card, 'hint');
  const decisions = add('details', '', card, 'paper-details');
  decisions.id = 'paper-checks-' + platform.platform;
  add('summary', 'בדיקות אחרונות לפי נכס', decisions);
  const items = Object.values(state.decisions).sort((a, b) => b.checkedAt - a.checkedAt);
  if (!items.length) add('p', 'טרם הושלמו בדיקות נכסים.', decisions, 'hint');
  for (const item of items) {const row = add('div', '', decisions, 'paper-event');
    add('strong', item.symbol, row); add('p', explain(item.reason), row); add('small', time(item.checkedAt), row);}
  const journal = add('details', '', card, 'paper-details');
  journal.id = 'paper-journal-' + platform.platform;
  add('summary', 'יומן איתותים ועסקאות מדומות (' + state.journalTotal + ')', journal);
  if (!state.journal.length) add('p', 'עדיין אין איתותים חדשים שעברו את התנאים. הדמו אינו יוצר עסקה כדי למלא את היומן.', journal, 'hint');
  for (const item of state.journal.slice(-30).reverse()) {
    const row = add('div', '', journal, 'paper-event');
    add('strong', ({SIGNAL: 'איתות', BUY: 'קנייה מדומה', SELL: 'מכירה מדומה', CANCEL: 'איתות בוטל'}[item.type] || item.type) + ' · ' + item.symbol, row);
    add('p', explain(item.reason), row); add('small', time(item.at), row);
    if (Number.isFinite(item.price)) add('p', 'מחיר: ' + num(item.price, 6) + ' · כמות: ' + num(item.quantity, 8) + ' · עלות מדומה: ' + num(item.fee, 4) +
      (Number.isFinite(item.pnl) ? ' · רווח/הפסד ממומש: ' + num(item.pnl) : ''), row, 'hint');
    context(row, item.research);
  }
  if (state.journal.length > 30) add('p', 'מוצגים 30 האירועים האחרונים. הסיכומים כוללים את כל העסקאות המדומות.', journal, 'hint');
}
async function refresh() {
  if ($('autoRefresh').disabled) return;
  $('autoRefresh').disabled = true;
  try {
    const response = await fetch('/.netlify/functions/trader-auto-status', {credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(12000)});
    const data = await response.json();
    if (!response.ok || data.version !== 'TRADER_AUTO_PAPER_V1' || data.mode !== 'PAPER_ONLY' || !Array.isArray(data.platforms)) throw Error('UNAVAILABLE');
    const opened = [...$('autoCards').querySelectorAll('details[open]')].map(el => el.id);
    $('autoCards').replaceChildren(); data.platforms.forEach(p => render(p, data.servedAt, data.policy?.enabled === true));
    for (const id of opened) {const el = $(id); if (el) el.open = true;}
    $('autoStatus').textContent = 'מצב שהתקבל מהשרת: ' + time(data.servedAt) + ' · התצוגה מתרעננת בכל דקה כשהעמוד פתוח.';
  } catch {
    $('autoStatus').textContent = 'לא ניתן לקרוא כרגע את מצב הדמו. אם מוצגים נתונים קודמים, אין לראות בהם אישור שהאוטומציה פועלת.';
  } finally {$('autoRefresh').disabled = false;}
}
$('autoRefresh').addEventListener('click', refresh);
refresh();
setInterval(() => {if (!document.hidden && document.getElementById('paperHistory')?.open) refresh();}, 60000);
