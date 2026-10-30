// Local, hypothetical long-only scenario. Inspired by trader-budget/trader-risk;
// it neither imports trading state nor creates order tickets.
export function planResearchTrade(input) {
  const values = {};
  for (const field of ['equity', 'cash', 'occupied', 'entry', 'stop', 'riskPct', 'costPct']) {
    const value = input[field];
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return {ok: false, reasons: ['יש למלא את כל שדות החישוב.']};
    values[field] = Number(value);
    if (!Number.isFinite(values[field])) return {ok: false, reasons: ['יש להזין מספרים תקינים בלבד.']};
  }
  const {equity, cash, occupied, entry, stop, riskPct, costPct} = values;
  const reasons = [];
  if (equity <= 0 || equity > 1e12 || cash < 0 || cash > equity) reasons.push('יש להזין שווי תיק חיובי ומזומן שאינו עולה עליו.');
  if (!Number.isInteger(occupied) || occupied < 0 || occupied > 5) reasons.push('מספר הפוזיציות חייב להיות מספר שלם בין 0 ל־5.');
  if (occupied === 5) reasons.push('כל חמש הפוזיציות תפוסות.');
  if (entry <= 0 || stop <= 0 || stop >= entry) reasons.push('בתרחיש רכישה מחיר הסטופ חייב להיות חיובי ונמוך ממחיר הכניסה.');
  if (riskPct <= 0 || riskPct > 100 || costPct < 0 || costPct > 100) reasons.push('אחוז הסיכון חייב להיות גדול מ־0 ועד 100; עלויות בין 0 ל־100.');
  if (input.alreadyHeld) reasons.push('הנכס כבר מוחזק: התרחיש מיועד לפוזיציה חדשה בלבד.');
  if (reasons.length) return {ok: false, reasons};
  const riskBudget = equity * riskPct / 100;
  const slotBudget = Math.min(equity * .2, cash);
  const cost = costPct / 100;
  const lossPerUnit = entry - stop + entry * cost;
  const rawQuantity = Math.min(slotBudget / (entry * (1 + cost)), riskBudget / lossPerUnit);
  const precision = input.wholeShares ? 1 : 1e8;
  const quantity = Math.floor(rawQuantity * precision) / precision;
  const notional = quantity * entry, estimatedCosts = notional * cost;
  const estimatedLoss = quantity * (entry - stop) + estimatedCosts;
  if (!(quantity > 0) || ![quantity, notional, estimatedCosts, estimatedLoss].every(Number.isFinite)) return {ok: false, reasons: ['התקציב אינו מספיק לכמות חיובית לפי הנתונים שהוזנו.']};
  return {ok: true, mode: 'SCENARIO_ONLY', quantity, notional, estimatedCosts, estimatedLoss, riskBudget, slotBudget,
    allocationPct: notional / equity * 100, estimatedLossPct: estimatedLoss / equity * 100,
    cashAfterCostReserve: cash - notional - estimatedCosts, reasons: []};
}
