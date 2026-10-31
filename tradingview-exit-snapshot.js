(function (global) {
  'use strict';
  // Read-only display adapter. No API calls, credentials, settings or orders.
  const VERSION = 'LEVI_EXIT_V1', MAX_AGE = 120000;
  const policies = ['FIXED_TP4_SL1_V1', 'PROFIT_FLOOR4_TRAIL1PP_STOP1_V1', 'PROFIT_ACTIVATE5_TRAIL1PP_STOP1_V2'];
  const positive = value => Number.isFinite(Number(value)) && Number(value) > 0;
  const timestamp = value => typeof value === 'number' ? value : Date.parse(value);
  const fresh = (value, now) => Number.isFinite(value) && value <= now && now - value <= MAX_AGE;
  function build(snapshot, symbol, now = Date.now()) {
    const fail = reason => ({ok:false, reason});
    if (!/^[A-Z0-9]{2,24}USDT$/.test(symbol || '')) return fail('בחר פוזיציה פעילה.');
    if (snapshot?.mode !== 'live') return fail('ספי הבוט ל־TradingView זמינים לפוזיציית Binance LIVE מנוהלת.');
    if (snapshot.error || snapshot.account?.connected !== true || snapshot.account.error) return fail('אין אימות עדכני של החשבון.');
    const agent = snapshot.agent?.agents?.find(a => a.symbol === symbol), p = agent?.strategy;
    const wallet = snapshot.account.balances?.find(b => b.asset + 'USDT' === symbol);
    if (agent?.position !== 'LONG' || agent.accountOnly || !policies.includes(p?.exitPolicy) ||
        !positive(p?.qty) || !positive(wallet?.qty) || !(Number(wallet?.valueUsdt) >= 5))
      return fail('לא אומתה פוזיציה פעילה שמנוהלת בבוט.');
    if (Math.abs(Number(p.qty) - Number(wallet.qty)) > Math.max(1e-8, Number(p.qty) * 1e-6))
      return fail('הכמות בחשבון ובפוזיציה אינה תואמת; ממתין להתאמה.');
    const times = [snapshot.receivedAt, timestamp(snapshot.account.updatedAt), timestamp(p.positionQuoteAt)];
    if (agent.staleData || times.some(t => !fresh(t, now))) return fail('נתוני הפוזיציה אינם עדכניים; ממתין לרענון.');
    const at = Math.min(...times), entryAt = timestamp(p.entryAt);
    const entry = Number(p.entryPrice), stop = Number(p.effectiveStopPrice), target = Number(p.targetPrice);
    const activation = p.exitPolicy === 'FIXED_TP4_SL1_V1' ? 0 : Number(p.activationPrice);
    if (![entry, stop, target, p.price].every(positive) || target <= entry ||
        !Number.isFinite(entryAt) || entryAt <= 0 || entryAt > at ||
        (activation !== 0 && !positive(activation))) return fail('חסרים ספי מכירה מתועדים מהשרת.');
    const armed = p.profitFloorArmed === true || p.trailingActive === true;
    const bp = p.brokerProtection;
    const brokerStop = bp?.status === 'ACTIVE' && bp.hasUnsettledFill !== true &&
      fresh(timestamp(bp.verifiedAt), now) && positive(bp.stopPrice) ? Number(bp.stopPrice) : 0;
    // Export prices already computed by execution, never recompute a stop from chart bars.
    const data = [VERSION, 'BINANCE:' + symbol, at, entryAt, entry, stop, target, activation, armed ? 1 : 0, brokerStop].map(value => typeof value === 'number' ? value.toLocaleString('en-US', {useGrouping:false, maximumSignificantDigits:21}) : value).join('|');
    return {ok:true, symbol, at, entryAt, entry, stop, target, activation, armed, brokerStop, data,
      reached:Number(p.price) <= stop ? 'STOP' : Number(p.price) >= target ? 'TARGET' : null};
  }
  const hosts = new Map();
  const fmt = n => Number(n).toLocaleString('en-US', {maximumSignificantDigits:10});
  const time = n => new Date(n).toLocaleTimeString('he-IL', {timeZone:'Asia/Jerusalem', hour12:false});
  function render(host, snapshot, symbol, now = Date.now()) {
    if (!host) return;
    hosts.set(host, {snapshot, symbol});
    const level = build(snapshot, symbol, now);
    if (!host._exitUI) {
      const make = (tag, text) => {const e = document.createElement(tag); e.textContent = text || ''; return e;};
      host.classList.add('exit-snapshot');
      const title = make('strong'), status = make('p'), detail = make('p'), button = make('button', 'העתק ספי מכירה ל־TradingView');
      button.type = 'button';
      const help = make('a', 'הצגת הספים על גרף TradingView ↗');
      help.href = '/tradingview-channels.html#exit-levels'; help.target = '_blank'; help.rel = 'noopener noreferrer';
      const copied = make('p'), field = make('textarea'); field.readOnly = true; field.dir = 'ltr'; field.rows = 3;
      field.setAttribute('aria-label', 'תמונת מצב של ספי המכירה להדבקה באינדיקטור'); field.hidden = true;
      copied.setAttribute('role', 'status');
      button.onclick = async () => {
        const context = hosts.get(host), current = build(context?.snapshot, context?.symbol);
        if (!current.ok) {render(host, context?.snapshot, context?.symbol); return;}
        field.value = current.data; field.hidden = false; field.focus(); field.select();
        copied.textContent = 'נתוני ' + current.symbol + ' מ־' + time(current.at) + '. הדבק בשדה Bot exit snapshot בהגדרות האינדיקטור. זו העתקה חד־פעמית.';
        try {await global.navigator.clipboard.writeText(current.data);} catch {
          if (field.value === current.data) copied.textContent += ' ההעתקה האוטומטית לא זמינה; העתק את הטקסט המסומן.';
        }
      };
      host.append(title, status, detail, button, help, copied, field);
      host._exitUI = {title, status, detail, button, copied, field, symbol};
    }
    const ui = host._exitUI;
    const positionKey = level.ok ? [symbol,level.entryAt,level.entry,level.stop,level.target,level.activation,level.armed].join('|') : null;
    if (ui.positionKey !== positionKey || !level.ok) {ui.field.value = ''; ui.field.hidden = true; ui.copied.textContent = '';}
    ui.positionKey = positionKey; ui.symbol = symbol; ui.button.disabled = !level.ok;
    ui.title.textContent = level.ok ? (level.armed ? 'סף מכירה נגרר' : 'סף עצירת הפסד') + ' · ' + fmt(level.stop) + ' USDT' : 'סף מכירה · לא אומת';
    ui.status.textContent = level.ok ? 'יעד Take Profit: ' + fmt(level.target) + (level.activation ? ' · הפעלת הגנת רווח: ' + fmt(level.activation) : '') + ' · נתונים מ־' + time(level.at) : level.reason;
    ui.detail.textContent = level.ok ? (level.reached ? 'לפי העדכון האחרון המחיר הגיע לסף; זו אינה אסמכתה שהמכירה בוצעה. ' : '') +
      (level.brokerStop ? 'סטופ שאומת בבורסה: ' + fmt(level.brokerStop) + '. ' : 'פקודת ההגנה בבורסה לא אומתה בעדכון זה. ') +
      'הסף באפליקציה מתעדכן עם נתוני הבוט. העתקה ל־TradingView אינה מתעדכנת אוטומטית. שיפוע רגרסיה שלילי אינו תנאי מכירה.' : '';
  }
  global.LEVI_EXIT_SNAPSHOT = {build, render, VERSION, MAX_AGE};
  global.setInterval?.(() => {
    for (const [host, context] of hosts) {
      if (!host.isConnected) {hosts.delete(host); continue;}
      render(host, context.snapshot, context.symbol);
    }
  }, 10000);
})(globalThis);
