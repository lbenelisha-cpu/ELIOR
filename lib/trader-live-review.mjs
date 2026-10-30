// Shared browser validation only; broker-side authentication and limits remain mandatory.
export const REVIEW_VERSION = 'LIVE_USER_REVIEW_V1';
export const REVIEW_MAX_AGE = 60000;
export function reviewInput(platform, values, snapshot, now = Date.now()) {
  if (!['BINANCE', 'COLMEX'].includes(platform)) throw Error('INVALID_PLATFORM');
  if (!snapshot || !Number.isFinite(snapshot.loadedAt) || now < snapshot.loadedAt || now - snapshot.loadedAt > REVIEW_MAX_AGE) throw Error('REFRESH_REQUIRED');
  if (!snapshot.enabled) throw Error('LIVE_NOT_READY');
  const symbol = String(values.symbol || '').trim().toUpperCase(), side = values.side;
  if (!(platform === 'BINANCE' ? /^[A-Z0-9]{2,20}USDT$/ : /^[A-Z][A-Z0-9.-]{0,14}$/).test(symbol) || !['BUY', 'SELL'].includes(side)) throw Error('INVALID_TRADE');
  if (side === 'BUY' && snapshot.buyBlocked) throw Error('ACCOUNT_CHECK_REQUIRED');
  const amount = Number(values.amount), max = snapshot.maxAmount;
  if (side === 'BUY' && (!Number.isFinite(amount) || amount < (platform === 'BINANCE' ? 5 : .01) || !Number.isFinite(max) || amount > max)) throw Error('INVALID_AMOUNT');
  if (side === 'BUY' && Number.isFinite(snapshot.cash) && amount * 1.002 > snapshot.cash) throw Error('INSUFFICIENT_CASH');
  if (side === 'SELL' && !snapshot.positions.some(p => p.symbol === symbol && p.quantity > 0)) throw Error('NO_POSITION');
  return {version: REVIEW_VERSION, platform, symbol, side, ...(side === 'BUY' ? {amount} : {}), reviewedAt: now};
}
export function orderBody(review, requestId) {
  if (review.version !== REVIEW_VERSION || !/^[a-f0-9-]{36}$/i.test(requestId)) throw Error('INVALID_REVIEW');
  if (review.platform === 'BINANCE') return {requestId, symbol: review.symbol, side: review.side, mode: 'live',
    ...(review.side === 'BUY' ? {quoteUsdt: review.amount} : {all: true})};
  return {requestId, symbol: review.symbol, side: review.side, ...(review.side === 'BUY' ? {amountUsd: review.amount} : {})};
}
export function reviewOutcome(platform, data, httpStatus = 200) {
  if (platform === 'BINANCE') {
    if (data?.uncertain) return {terminal: false, text: 'תוצאת ההוראה טרם אומתה. אין לשלוח הוראה נוספת; בדוק את אותה בקשה.'};
    if (data?.ok && data.order && ['FILLED', 'PARTIALLY_FILLED'].includes(data.order.status))
      return {terminal: true, text: 'בייננס אישרה ' + data.order.status + ' · כמות שבוצעה: ' + data.order.executedQty + ' · מזהה: ' + data.order.orderId};
    if (data?.ok === false && data?.uncertain === false) return {terminal: true, text: data.error || 'ההוראה נדחתה ללא ביצוע.'};
  } else {
    const messages = {FILLED: 'הברוקר אישר ביצוע קנייה.', CLOSED: 'הברוקר אישר סגירת הפוזיציה.', NO_FILL: 'ההוראה הסתיימה ללא מילוי.',
      NOT_SENT: 'ההוראה לא נשלחה לברוקר.', REJECTED: 'הברוקר דחה את ההוראה.'};
    if (messages[data?.status]) return {terminal: true, text: messages[data.status]};
    if (data?.status === 'NOT_RECORDED') return {terminal: false, text: 'לא נמצא רישום לבקשה. אין בכך אישור שלא נשלחה; בדוק שוב או בדוק אצל הברוקר.'};
  }
  if ([400, 401, 403, 409, 405].includes(httpStatus) && !data?.acknowledged && !data?.status)
    return {terminal: true, text: 'הבקשה לא אושרה: ' + String(data?.error || httpStatus)};
  return {terminal: false, text: data?.acknowledged ? 'הברוקר אישר קבלת הוראה; ממתין לאימות ביצוע.' : 'תוצאת הבקשה עדיין אינה ידועה. בדיקת מצב אינה שולחת הוראה חדשה.'};
}
