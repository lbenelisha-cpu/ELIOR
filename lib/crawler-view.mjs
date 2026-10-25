// Read-only view model for the Python crypto_crawler API. No trading decisions here.
export const SUPPORTED_VERSION = '2.1.2';
export function validateSnapshot(s) {
  if (!s || typeof s !== 'object' || !/^2\.[1-9]\d*\.\d+$/.test(s.version || '') ||
      !['live', 'paper', 'testnet', 'replay'].includes(s.mode) || typeof s.real_money !== 'boolean' ||
      !Number.isFinite(s.now) || !Number.isFinite(s.equity) || !s.day || !s.settings ||
      !['positions', 'orphans', 'pending', 'waiting', 'radar', 'events'].every(k => Array.isArray(s[k]))) {
    throw Error('השרת אינו מחזיר נתוני crypto_crawler תואמים.');
  }
  if ((s.mode === 'live') !== s.real_money) throw Error('מצב הכסף בשרת אינו עקבי.');
  return s;
}
export function connectionState(snapshot, health, receivedAt, now = Date.now()) {
  if (!snapshot || !receivedAt) return {current:false, label:'ממתין לחיבור'};
  // Engine time may deliberately differ from wall time in replay.
  const fresh = now - receivedAt < 30_000 && now >= receivedAt;
  const running = health?.ok === true && Number.isFinite(health.tick_age_s) && health.tick_age_s >= 0 && health.tick_age_s < 30;
  return {current:fresh && running, label:!fresh ? 'נתונים ישנים — החיבור לא אומת' : !running ? 'המנוע אינו מאומת כפעיל' : 'מחובר לשרת הבוט'};
}
export function protectionLabel(p) {
  if (p.close_reason || p.closing) return 'סגירה בהמתנה לאישור';
  if (!(Number.isFinite(p.qty) && p.qty > 0 && p.stop_id && Number.isFinite(p.stop_price) && p.stop_price > 0 && Number.isFinite(p.stop_qty) && p.stop_qty + 1e-10 >= p.qty)) return 'הגנה דורשת בדיקה ביומן';
  return 'פקודת הגנה רשומה במנוע';
}
export function reservedSymbols(s) {
  return new Set(['positions','orphans','pending','waiting'].flatMap(k => (s[k] || []).map(p => p.symbol))).size;
}
export const modeNames = {live:'כסף אמיתי',paper:'מחירים חיים · כסף מדומה',testnet:'סביבת בדיקה',replay:'שחזור היסטורי'};
export const reasonNames = {'target hit':'הגעה ליעד', 'stop-loss':'עצירת הפסד', 'trade break-even stop':'עצירה סביב איזון העסקה', 'rest break-even stop':'עצירה סביב איזון היתרה', 'tightened stop after TP1':'עצירה שהתקדמה לאחר מימוש חלקי', 'time limit':'מגבלת זמן', 'no bounce after 15 min':'אין התאוששות לאחר 15 דקות'};
