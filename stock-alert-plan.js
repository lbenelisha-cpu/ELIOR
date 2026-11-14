// The manual stock alert is emitted by tradingview/levi-channels.pine.
// Keep the reported prices and the New York bar-close time as sent.
const amount = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;
const header = /LEVI\s*·\s*איתות\s+לבדיקה\s+ידנית/u;
const fields = [
  String.raw`^LEVI · איתות לבדיקה ידנית · (?<symbol>(?:NYSE|NASDAQ|AMEX|NYSEARCA|CBOE|BATS):[A-Z0-9]+(?:[.\-][A-Z0-9]+)*) · (?<side>LONG|SHORT)`,
  String.raw`סגירת נר 5 דקות: (?<date>\d{4}-\d{2}-\d{2}) (?<clock>\d{2}:\d{2}) \(ניו יורק\)`,
  String.raw`מחיר ייחוס: (?<reference>${amount}) USD · סטופ התחלתי: (?<stop>${amount}) \((?<stopPct>${amount})%\)`,
  String.raw`יעד מימוש: (?<target>${amount}) \((?<targetPct>${amount})%\)`,
  String.raw`הפעלת הגנה לפי ממוצע 5 גלים: (?<activation>${amount}) \((?<activationPct>${amount})% מהכניסה\)`,
  String.raw`אחרי ההפעלה: מרחק סטופ של (?<trail>${amount}) USD (?<direction>מתחת לשיא|מעל לשפל) \((?<trailPp>${amount}) נקודות אחוז ממחיר הכניסה\)`,
  String.raw`(?:הביצוע ועדכון הסטופ ידניים\. יש לחשב את הרמות לפי מחיר הביצוע בפועל\.)?$`,
];
const message = new RegExp(fields.join(' ').replaceAll(' ', String.raw`\s*`), 'u');
const numericFields = ['reference', 'stop', 'stopPct', 'target', 'targetPct', 'activation', 'activationPct', 'trail', 'trailPp'];

export function parseStockAlert(text) {
  if (typeof text !== 'string') return null;
  const clean = text.replace(/\p{Bidi_Control}/gu, '').trim();
  const start = clean.search(header);
  if (start < 0) return null;
  const match = message.exec(clean.slice(start));
  if (!match) return null;
  const { symbol, side, date, clock, direction } = match.groups;
  // Validate the calendar fields in UTC without converting the exchange-local time.
  const iso = `${date}T${clock}:00.000Z`;
  const stamp = Date.parse(iso);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString() !== iso) return null;
  const plan = { symbol, side, barTime: `${date} ${clock}` };
  for (const field of numericFields) {
    const value = Number(match.groups[field]);
    if (!Number.isFinite(value) || value <= 0) return null;
    plan[field] = value;
  }
  const long = side === 'LONG';
  if (direction !== (long ? 'מתחת לשיא' : 'מעל לשפל')) return null;
  // Rounding to the symbol tick may make adjacent alert levels equal.
  if (long ? plan.stop > plan.reference || plan.activation < plan.reference || plan.target < plan.activation
           : plan.stop < plan.reference || plan.activation > plan.reference || plan.target > plan.activation) return null;
  if (plan.targetPct < plan.activationPct) return null;
  return plan;
}

export function mergeStockAlert(plans, plan) {
  const latest = new Map();
  for (const item of [...plans, plan]) {
    const prior = latest.get(item.symbol);
    if (!prior || item.barTime > prior.barTime) latest.set(item.symbol, item);
  }
  return [...latest.values()].sort((a, b) => b.barTime.localeCompare(a.barTime)).slice(0, 50);
}
