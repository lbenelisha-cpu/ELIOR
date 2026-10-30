// Display-only calculations. This module has no trading or network access.
export const finite = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

export function tradeScenario({amount, entry, target, stop, feePct}) {
  const values = [amount, entry, target, stop, feePct].map(finite);
  if (values.some(v => v === null)) return {error:'יש למלא את כל השדות במספרים תקינים.'};
  [amount, entry, target, stop, feePct] = values;
  if (!(amount > 0 && entry > 0 && stop > 0 && target > entry && stop < entry))
    return {error:'הסכום ומחיר הכניסה חייבים להיות חיוביים; היעד מעל הכניסה והסטופ מתחתיה.'};
  if (feePct < 0 || feePct > 5) return {error:'העמלה לכל צד צריכה להיות בין 0% ל־5%.'};
  const fee = feePct / 100, quantity = amount / entry, debit = amount * (1 + fee);
  const targetPnl = quantity * target * (1 - fee) - debit;
  const stopPnl = quantity * stop * (1 - fee) - debit;
  const breakEven = entry * (1 + fee) / (1 - fee);
  const result = {quantity, debit, targetPnl, stopPnl, breakEven,
    ratio:targetPnl > 0 && stopPnl < 0 ? targetPnl / -stopPnl : null,
    targetFees:amount * fee + quantity * target * fee};
  return Object.values(result).some(v => v !== null && !Number.isFinite(v))
    ? {error:'הערכים גדולים מדי לחישוב.'} : result;
}

export function allocationParts(total, availableCash) {
  total = finite(total); availableCash = finite(availableCash);
  if (!(total > 0) || availableCash === null || availableCash < 0 || availableCash > total) return null;
  return {cash:availableCash, other:total - availableCash, cashPct:availableCash / total * 100};
}

export function accountSummary({mode, account, agent}) {
  if (mode === 'live') {
    if (!account || finite(account.totalValueUsdt) === null) return null;
    const positions = (account.balances || []).filter(b => !['USDT','USDC'].includes(b.asset) && finite(b.valueUsdt) >= 5);
    const known = positions.every(p => finite(p.pnlIls) !== null);
    return {currency:'USDT', total:finite(account.totalValueUsdt), cash:finite(account.usdtFree),
      pnl:known ? positions.reduce((s,p) => s + Number(p.pnlIls), 0) : null,
      count:positions.length, max:finite(account.maxPositions) || 5,
      partial:!!account.unpricedAssets?.length, positions:positions.map(p => ({...p,symbol:p.asset+'USDT'}))};
  }
  const p = agent?.paper;
  if (!p || p.error || finite(p.valueIls) === null) return null;
  return {currency:p.currency || '₪', total:finite(p.valueIls), cash:finite(p.cashIls), pnl:finite(p.profitIls),
    count:Object.keys(p.positions || {}).length, max:finite(p.maxPositions) || 10, partial:false,
    positions:Object.entries(p.positions || {}).map(([symbol,p]) => ({...p,symbol,valueUsdt:p.currentValueIls}))};
}

export function accountCheckDetails(health, now = Date.now()) {
  if (!health) return ['טרם התקבלו בדיקות החשבון מהשרת.'];
  const rows = [], reconciliation = health.reconciliation || {};
  const symbols = list => (Array.isArray(list) ? list : []).map(x => typeof x === 'string' ? x : x?.symbol).filter(x => /^[A-Z0-9]{2,30}$/.test(x || '')).join(', ');
  if (health.journalReady === false) rows.push('יומן העסקאות לא נטען או לא נשמר באופן תקין; נדרש בירור בשרת.');
  if (health.pendingOrder) rows.push('יש פקודת מסחר שתוצאתה עדיין לא אומתה מול בייננס. אין לשלוח אותה שוב.');
  if (symbols(reconciliation.unmanaged)) rows.push('נמצאו יתרות שאין להן פוזיציה מנוהלת ביומן: ' + symbols(reconciliation.unmanaged) + '. ההגנות שלהן לא אומתו.');
  if (symbols(reconciliation.pending)) rows.push('קיים פער כמות בין הארנק ליומן, הממתין לקריאה נוספת לאימות: ' + symbols(reconciliation.pending) + '.');
  if (symbols(reconciliation.unsettled)) rows.push('מילוי של פקודת הגנה עדיין מתאמת מול הבורסה: ' + symbols(reconciliation.unsettled) + '.');
  if (symbols(health.missingProtection)) rows.push('פקודת ההגנה חסרה, לא עדכנית או אינה תואמת לכמות המנוהלת: ' + symbols(health.missingProtection) + '.');
  const known = {NATIVE_PROTECTION_PENDING_RECONCILIATION:'אימות פקודות ההגנה בבורסה עדיין לא הסתיים.',
    LIVE_ACCOUNT_SNAPSHOT_INVALID:'קריאת החשבון אינה תקינה או אינה עדכנית.', LIVE_ACCOUNT_SNAPSHOT_NOT_NEW:'השרת ממתין לקריאת חשבון חדשה.',
    LIVE_ACCOUNT_BALANCE_INVALID:'נתוני היתרות שקיבל השרת אינם עקביים.', LIVE_EXECUTION_JOURNAL_UNAVAILABLE:'שמירת יומן העסקאות נכשלה.',
    LIVE_POSITION_IDENTITY_INVALID:'פרטי הפוזיציה ביומן אינם תקינים.'};
  if (reconciliation.error) rows.push(known[reconciliation.error] || 'בדיקת ההתאמה לחשבון נכשלה; נדרש לבדוק את שגיאת השרת.');
  const checked = Date.parse(reconciliation.checkedAt);
  if (!Number.isFinite(checked) || checked > now + 5000 || now - checked > 60000) rows.push('אין אימות חשבון עדכני מהדקה האחרונה; הפרטים הקודמים אינם אישור שההגנות פעילות.');
  if (health.ready !== true && !rows.length) rows.push('השרת מדווח שאימות החשבון לא הושלם, בלי פירוט נוסף.');
  return rows;
}

export function protectionState(health, now = Date.now()) {
  const checked = Date.parse(health?.reconciliation?.checkedAt);
  if (!health || !Number.isFinite(checked) || now - checked > 60000 || checked > now + 5000)
    return {kind:'unknown', text:'ממתין לאימות הגנות עדכני'};
  if (health.missingProtection?.length) return {kind:'warning', text:'הגנה חסרה / לא אומתה: '+health.missingProtection.join(', ')};
  if (health.ready !== true) return {kind:'warning', text:accountCheckDetails(health, now)[0]};
  if(health.softwareTargets?.length)return {kind:'good',text:'הסטופ אומת בבורסה · יעד הרווח במעקב השרת: '+health.softwareTargets.join(', ')};
  return {kind:'good', text:health.managedPositions > 0?'ההגנות אומתו בבורסה':'אין פוזיציות מנוהלות להגנה'};
}
