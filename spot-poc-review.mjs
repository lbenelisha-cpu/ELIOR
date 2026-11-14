import { spotPocDiagnostics } from './spot-poc-diagnostics.mjs';

const amount = new Intl.NumberFormat('he-IL', { maximumSignificantDigits: 6 });
const price = new Intl.NumberFormat('he-IL', { maximumSignificantDigits: 12 });
const dateTime = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short'
});
const waveLabel = {
  armed: 'הופעלה', not_armed: 'לא הופעלה לפי תיעוד הבוט',
  threshold_reached: 'סף הגלים נחצה · הפעלה לא אומתה', unknown: 'לא ידוע'
};

function format(value, suffix = '', formatWith = amount) {
  return Number.isFinite(value) ? formatWith.format(value) + suffix : 'חסר';
}

function makeTable(doc, label, headings, rows) {
  const wrapper = doc.createElement('div');
  wrapper.className = 'strategy-table-wrap';
  wrapper.tabIndex = 0;
  wrapper.setAttribute('role', 'region');
  wrapper.setAttribute('aria-label', label + ' · גלילה אופקית');
  const table = doc.createElement('table');
  table.className = 'terminal-table';
  table.setAttribute('aria-label', label);
  const header = table.createTHead().insertRow();
  for (const title of headings) {
    const cell = doc.createElement('th');
    cell.scope = 'col';
    cell.textContent = title;
    header.append(cell);
  }
  const body = table.createTBody();
  for (const values of rows) {
    const row = body.insertRow();
    for (const value of values) {
      const cell = row.insertCell();
      const text = doc.createElement('bdi');
      text.textContent = value;
      cell.append(text);
    }
  }
  wrapper.append(table);
  return wrapper;
}

function outcomeRow(title, stats) {
  return [title, stats.count, format(stats.avgCost), format(stats.avgReturnPct, '%'), format(stats.avgNet)];
}

function reasonText(reason, view) {
  if (!reason) return 'לא תועדה';
  if (typeof view?.decisionReasonLabel === 'function') return view.decisionReasonLabel(reason);
  return reason;
}

function tradeRow(trade, view) {
  const threshold = Number.isFinite(trade.activationPrice)
    ? `${format(trade.activationPrice, '', price)} (${format(trade.activationPct, '%')})`
    : 'לא ידוע';
  return [trade.symbol, dateTime.format(new Date(trade.exitAt)), format(trade.cost), format(trade.net),
    format(trade.returnPct, '%'), reasonText(trade.reason, view), waveLabel[trade.wave], threshold];
}

export function renderSpotPocReview(host, log, mode) {
  if (!host) return;
  const summary = host.querySelector('[data-poc-summary]');
  const rows = host.querySelector('[data-poc-rows]');
  const details = host.querySelector('details');
  if (!summary || !rows || !details) return;

  let missing;
  if (mode !== 'live') missing = 'הדוח זמין במצב מסחר חי (LIVE).';
  else if (!Array.isArray(log?.netJournal?.live)) missing = 'יומן המסחר החי אינו זמין כרגע.';
  const report = missing ? null : spotPocDiagnostics(log);
  if (missing || !report.counts.closed) {
    summary.textContent = missing || 'ביומן אין עדיין פוזיציות Spot סגורות בשיטת POC V2.';
    rows.replaceChildren();
    details.hidden = true;
    return;
  }

  const doc = host.ownerDocument;
  const { counts, winners, losers, trades } = report;
  const totals = doc.createElement('p');
  const rate = counts.verified ? `${format(100 * counts.wins / counts.verified, '%')} הצלחה מתוך ${counts.verified} עם נתוני נטו מלאים` : 'אין נתוני נטו מלאים';
  totals.textContent = `${counts.closed} פוזיציות סגורות · ${rate} · ${counts.flat} באיזון · ${counts.unknown} עם נתוני עלות או עמלות חסרים`;
  const results = makeTable(doc, 'השוואת פוזיציות ברווח ובהפסד לפי תוצאה נטו',
    ['תוצאה נטו', 'פוזיציות', 'עלות ממוצעת של הכמות שנמכרה (USDT)', 'תשואה ממוצעת', 'רווח / הפסד ממוצע (USDT)'],
    [outcomeRow('רווח', winners), outcomeRow('הפסד', losers)]);
  const losses = trades.filter(t => Number.isFinite(t.net) && t.net < 0);
  const waveCounts = { armed: 0, not_armed: 0, threshold_reached: 0, unknown: 0 };
  for (const t of losses) waveCounts[t.wave]++;
  const waves = doc.createElement('p');
  waves.textContent = losses.length
    ? `הגנת הגלים ב־${losses.length} פוזיציות שנסגרו בהפסד נטו · הופעלה ${waveCounts.armed} · סף הגלים נחצה וההפעלה לא אומתה ${waveCounts.threshold_reached} · לא הופעלה לפי תיעוד הבוט ${waveCounts.not_armed} · לא ידוע ${waveCounts.unknown}`
    : 'אין פוזיציות בהפסד נטו מאומת לבדיקת הגנת הגלים.';
  summary.replaceChildren(totals, results, waves);
  const table = makeTable(doc, 'פירוט פוזיציות סגורות בשיטת POC V2',
    ['נכס', 'יציאה (שעון ישראל)', 'עלות הכמות שנמכרה (USDT)', 'רווח / הפסד נטו (USDT)', 'תשואה נטו', 'סיבת יציאה', 'הגנת הגלים לפני היציאה', 'מחיר הפעלת ההגנה (USDT) ושיעור העלייה'],
    trades.map(trade => tradeRow(trade, doc.defaultView)));
  rows.replaceChildren(table);
  details.hidden = false;
}
