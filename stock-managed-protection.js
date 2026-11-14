import './position-barriers.js';
import {protectionView} from './lib/colmex-dashboard-math.mjs';

const barriers = globalThis.LEVI_POSITION_BARRIERS;
const amount = new Intl.NumberFormat('en-US', {maximumSignificantDigits: 10});
const israelTime = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short',
});
const timestamp = value => typeof value === 'number' ? value : Date.parse(value);
const fresh = (value, now) => {
  const time = timestamp(value);
  return time > 0 && time <= now && now - time <= barriers.MAX_AGE;
};
const timeText = value => {
  const time = timestamp(value);
  return Number.isFinite(time) && time > 0 ? israelTime.format(time) : 'לא ידוע';
};
const positive = value => Number.isFinite(value) && value > 0;
const dollars = value => positive(value) ? '$' + amount.format(value) : 'לא דווח';

function element(tag, text) {
  const item = document.createElement(tag);
  item.textContent = text;
  return item;
}

function addField(list, label, value) {
  const row = document.createElement('div');
  row.append(element('dt', label), element('dd', value));
  list.append(row);
}

function renderManagedPolicy(host, status, failed) {
  if (!host) return;
  host.replaceChildren();
  const policy = status?.policy;
  if (!policy) return;
  const fields = document.createElement('dl');
  for (const [label, key] of [
    ['סטופ־לוס', 'stopLossPct'], ['יעד רווח', 'takeProfitPct'],
    ['סף הפעלה בסיסי', 'profitActivationPct'], ['מרווח נגרר', 'trailingGapPp'],
  ]) {
    const unit = key === 'trailingGapPp' ? ' נקודות אחוז ממחיר הכניסה' : '%';
    addField(fields, label, positive(policy[key]) ? amount.format(policy[key]) + unit : 'לא דווח');
  }
  const heading = failed ? 'הגדרות הבוט בדיווח הקודם' : 'הגדרות הבסיס של בוט המניות';
  host.append(element('h3', heading), fields, element('p',
    'כשיש חמישה גלים מאושרים, גובהם הממוצע קובע את סף ההפעלה לפוזיציה. הגדרות האיתות הידני נקבעות בנפרד ב־TradingView.'));
}

function managedCard(position, status, failed, now) {
  const side = position.side || 'LONG';
  const card = document.createElement('article');
  card.className = 'managed-position';
  card.append(element('h3', position.symbol + ' · ' + side));

  const pending = (status.pendingActions || []).filter(item => !item.quarantined);
  const levels = barriers.levels(position, {
    side, now, observedAt: timestamp(status.lastBrokerSnapshotAt),
    unavailable: failed || pending.some(item => item.symbol === position.symbol),
  });
  const fields = document.createElement('dl');
  function levelText(kind) {
    const line = levels?.lines.find(item => item.kind === kind);
    return line ? dollars(line.price) + ' (' + (line.pct > 0 ? '+' : '') + line.pct.toFixed(2) + '%)' : 'לא דווח';
  }
  addField(fields, 'מחיר כניסה', dollars(position.entryPrice));
  addField(fields, 'מחיר אחרון שנצפה', dollars(levels?.price ?? position.lastBid));
  addField(fields, 'סטופ־לוס התחלתי', dollars(position.stopPrice));
  addField(fields, 'סטופ לפי דיווח הבוט', levelText('stop'));
  addField(fields, 'יעד רווח', levelText('target'));

  const fixed = position.exitPolicy === 'FIXED_TP4_SL1_V1';
  if (fixed) {
    addField(fields, 'מדיניות יציאה', 'סטופ ויעד קבועים');
  } else {
    addField(fields, 'סף הפעלת הגנת רווח', levelText('activation'));
    const armed = position.profitFloorArmed;
    const state = armed === true ? 'הופעלה' : armed === false ? 'טרם הופעלה' : 'לא דווח';
    addField(fields, 'הגנת רווח בדיווח האחרון', state);
    const gap = position.trailingGapPp ?? position.exitSettings?.trailingGapPp;
    addField(fields, 'מרווח הסטופ הנגרר', positive(gap) ? amount.format(gap) + ' נקודות אחוז ממחיר הכניסה' : 'לא דווח');
  }
  addField(fields, side === 'SHORT' ? 'שפל מאז הכניסה' : 'שיא מאז הכניסה',
    dollars(side === 'SHORT' ? position.lowPrice : position.peakPrice));
  card.append(fields, element('p', (levels && !levels.stale ? 'מחיר שנצפה' : 'מחיר קודם או לא מאומת') + ' · ' + timeText(position.lastQuoteAt)));

  const verifiedAt = position.brokerProtection?.verifiedAt;
  if (failed || !fresh(status.lastBrokerSnapshotAt, now) || !fresh(verifiedAt, now)) {
    card.append(element('p', 'פקודות הברוקר אינן מאומתות כעת · בדיקת הגנות אחרונה ' + timeText(verifiedAt)));
  } else {
    const protection = protectionView(position, pending, now);
    card.append(element('p', protection.label + ' · ' + timeText(verifiedAt)));
    const brokerFields = document.createElement('dl');
    addField(brokerFields, 'סטופ שדווח בברוקר', dollars(protection.stop));
    addField(brokerFields, 'יעד שדווח בברוקר', dollars(protection.target));
    card.append(brokerFields);
  }
  return card;
}

export function initManagedProtection() {
  const message = document.getElementById('managedStatus');
  const host = document.getElementById('managedPositions');
  const policy = document.getElementById('managedPolicy');
  const button = document.getElementById('refreshManaged');
  let status = null;
  let failed = false;
  let loading = false;

  function render() {
    const now = Date.now();
    const positions = status?.positions || [];
    const checked = status?.lastBrokerSnapshotAt;
    const info = [];
    if (failed) info.push('קריאת דיווח הבוט נכשלה.');
    if (!status) info.push(failed ? 'מצב הפוזיציות אינו ידוע.' : 'טוען את דיווח הבוט.');
    else {
      if (status.enabled === false) info.push('המסחר האוטומטי כבוי.');
      if (positions.length) info.push('פוזיציות בדיווח הבוט האחרון: ' + positions.length + '.');
      else if (checked) info.push('בדיווח האחרון לא הופיעו פוזיציות בניהול הבוט.');
      else info.push('טרם התקבל דיווח ברוקר המאמת את מצב הפוזיציות.');
      if (checked) info.push('בדיקת ברוקר אחרונה ' + timeText(checked) + '.');
    }
    message.textContent = info.join(' ');
    renderManagedPolicy(policy, status, failed);
    host.replaceChildren(...positions.map(position => managedCard(position, status, failed, now)));
  }

  async function refresh() {
    if (loading || document.hidden) return;
    loading = true;
    button.disabled = true;
    try {
      const response = await fetch('/.netlify/functions/colmex-auto-status', {
        cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw Error();
      const report = await response.json();
      if (report?.live !== true || !Array.isArray(report.positions)) throw Error();
      status = report;
      failed = false;
    } catch {
      failed = true;
    } finally {
      loading = false;
      button.disabled = false;
      render();
    }
  }

  button.addEventListener('click', refresh);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { render(); refresh(); }
  });
  setInterval(refresh, 60000);
  setInterval(() => { if (!document.hidden && status) render(); }, 15000);
  render();
  refresh();
}
