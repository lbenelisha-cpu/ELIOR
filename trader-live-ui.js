import {reviewInput, orderBody, reviewOutcome, REVIEW_MAX_AGE} from './lib/trader-live-review.mjs?v=20261030-live-review';
import {protectionState, accountCheckDetails} from './lib/binance-dashboard-math.mjs?v=20261030-live-review';
const $ = id => document.getElementById(id);
const add = (tag, text, host, cls) => {const el = document.createElement(tag); el.textContent = text; if (cls) el.className = cls; host.append(el); return el;};
const BINANCE = 'https://levi-binance.2-29-48-20.sslip.io';
const configs = {
  BINANCE: {name: 'Binance', currency: 'USDT', tokenKey: 'levi-binance-control-v1', pendingKey: 'levi-binance-review-pending-v1', href: '/binance-agent.html'},
  COLMEX: {name: 'Colmex Pro', currency: 'USD', tokenKey: 'levi-colmex-device-v1', pendingKey: 'levi-colmex-manual-pending-v1', href: '/colmex-pro.html'}
};
const snapshots = {}, pending = {}, busy = {}, cards = {};
let review = null, sending = false, selectedPending = null;
const errors = {REFRESH_REQUIRED: 'נתוני החשבון התיישנו. רענן והכן את העסקה מחדש.', LIVE_NOT_READY: 'מסחר LIVE אינו זמין כרגע. בדוק חיבור ומצב במסך הפלטפורמה.',
  ACCOUNT_CHECK_REQUIRED: 'החשבון עדיין אינו מאומת לקנייה. פתח את פירוט הבדיקות.', INVALID_TRADE: 'בדוק את סימול הנכס וסוג הפעולה.',
  INVALID_AMOUNT: 'הסכום אינו תקין או חורג מתקרת הפעולה המוצגת.', INSUFFICIENT_CASH: 'אין מספיק מזומן זמין לסכום ולעתודת עמלה.', NO_POSITION: 'לא אומתה פוזיציה במניה או במטבע הזה. בדוק במסך הפלטפורמה.',
  AUTH_REQUIRED: 'יש לחבר את המכשיר במסך הפלטפורמה, ואז לחזור ולרענן כאן.', SOURCE_UNAVAILABLE: 'לא ניתן לקבל מצב מאומת מהשרת כרגע.'};
const explain = e => errors[e?.message] || 'הבדיקה לא הושלמה. לא נשלחה הוראה.';
const at = value => {const n = typeof value === 'number' ? value : Date.parse(value); return Number.isFinite(n) ? new Date(n).toLocaleString('he-IL', {timeZone:'Asia/Jerusalem'}) : '—';};
function token(platform) {try {return localStorage.getItem(configs[platform].tokenKey);} catch {return null;}}
function remember(platform, value) {
  // Persistence must succeed BEFORE the financial request, including on reload.
  if (value) {const text = JSON.stringify(value); localStorage.setItem(configs[platform].pendingKey, text);
    if (localStorage.getItem(configs[platform].pendingKey) !== text) throw Error('STORAGE_UNAVAILABLE');}
  else localStorage.removeItem(configs[platform].pendingKey);
  pending[platform] = value;
}
async function api(platform, path, body) {
  const credential = token(platform); if (!credential) throw Error('AUTH_REQUIRED');
  const url = platform === 'BINANCE' ? body ? BINANCE + path : '/.netlify/functions/binance-read-proxy?path=' + encodeURIComponent(path) : '/.netlify/functions/' + path;
  const response = await fetch(url, {method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(35000),
    headers: {Authorization: 'Bearer ' + credential, ...(body ? {'Content-Type':'application/json'} : {})}, ...(body ? {body: JSON.stringify(body)} : {})});
  const data = await response.json();
  if (!body && response.status === 401) throw Error('AUTH_REQUIRED');
  if (!body && !response.ok) throw Error('SOURCE_UNAVAILABLE');
  return {data, status: response.status};
}
async function snapshot(platform) {
  if (platform === 'BINANCE') {
    const [{data: mode}, {data: agent}, {data: account}] = await Promise.all(['/api/binance-mode', '/api/binance-agent', '/api/binance-live-account'].map(path => api(platform, path)));
    const health = agent.config?.liveState, live = mode.mode === 'live' && agent.mode === 'live';
    const enabled = live && mode.manualTrading?.version === 1 && mode.liveTradingEnabled === true && mode.autoExecution === true && account.connected === true;
    const positions = (account.account?.balances || []).map(p => ({symbol:p.asset + 'USDT', quantity:Number(p.qty ?? p.free), price:Number(p.usdtPrice)}));
    return {loadedAt: Date.now(), enabled, maxAmount: Number(mode.manualTrading?.maxOrderUsdt), cash: account.account?.usdtFree,
      positions, settings: mode.exitSettings, buyBlocked: protectionState(health).kind !== 'good' || agent.tradeControl?.paused === true,
      status: !live ? 'השרת אינו במצב LIVE; מעבר מצב נעשה במסך בייננס.' : protectionState(health).text,
      details: accountCheckDetails(health), automatic: live && mode.autoExecution === true && !agent.tradeControl?.paused,
      candidates: (agent.agents || []).filter(a => live && a.entryConfirmed === true && a.position !== 'LONG' && !a.staleData &&
        Date.now() - Date.parse(a.lastDecisionAt) >= 0 && Date.now() - Date.parse(a.lastDecisionAt) < 60000).slice(0, 6).map(a => ({symbol:a.symbol, at:a.lastDecisionAt}))};
  }
  const {data} = await api(platform, 'colmex-auto-status');
  const fresh = Number.isFinite(data.lastCompletedAt) && Date.now() >= data.lastCompletedAt && Date.now() - data.lastCompletedAt < 90000;
  return {loadedAt:Date.now(), enabled:data.enabled === true, maxAmount:Number(data.policy?.notionalUsd), cash:null,
    positions:(data.positions || []).map(p => ({symbol:p.symbol, quantity:p.qty, price:p.lastBid})), settings:data.policy,
    buyBlocked:data.status !== 'MONITORING' || !fresh, automatic:data.enabled === true,
    status: data.status === 'MONITORING' && fresh ? 'מסחר LIVE מוגדר בשרת · השרת בודק את החשבון.' : 'מצב שרת: ' + data.status + ' · מחזור אחרון: ' + at(data.lastCompletedAt),
    details: [data.halt ? 'המסחר חסום לבירור: ' + data.halt : '', data.lastError ? 'בדיקת השרת נכשלה: ' + data.lastError.reason : '',
      data.pending ? 'קיימת הוראה שעדיין ממתינה לאימות; אין לשלוח אותה שוב.' : ''].filter(Boolean),
    candidates: Object.entries(data.checks || {}).filter(([,c]) => c.reason === 'READY' && c.technicalReady === true && Date.now() >= c.at && Date.now() - c.at < 60000)
      .slice(0,6).map(([symbol,c]) => ({symbol, at:c.at}))};
}
function render(platform) {
  const c = cards[platform], s = snapshots[platform];
  c.submit.disabled = busy[platform] || !s?.enabled || !!pending[platform];
  c.refresh.disabled = !!busy[platform]; c.check.hidden = !pending[platform];
  c.check.disabled = !!busy[platform] || sending;
  if (!s) return;
  c.status.textContent = s.status;
  c.status.className = 'paper-state' + (!s.enabled || s.buyBlocked ? ' attention' : '');
  c.details.replaceChildren(); s.details.forEach(text => add('li', text, c.details));
  c.amount.max = Number.isFinite(s.maxAmount) ? String(s.maxAmount) : '';
  c.limit.textContent = 'תקרה לפעולה: ' + (Number.isFinite(s.maxAmount) ? s.maxAmount : '—') + ' ' + configs[platform].currency +
    (Number.isFinite(s.cash) ? ' · מזומן זמין: ' + s.cash.toLocaleString('he-IL', {maximumFractionDigits:2}) : ' · היתרה נבדקת בשרת לפני השליחה');
  c.automatic.textContent = s.automatic ? 'קיים גם מנוע מסחר אוטומטי נפרד. אישור במסך זה אינו משהה אותו. פקודות הגנה קיימות ממשיכות לפי ההגדרות.' : 'המסך הזה אינו משנה מצב מסחר או מפעיל מנוע אוטומטי.';
  c.candidates.replaceChildren();
  if (!s.candidates.length) add('p', 'אין כרגע איתות חדש ועדכני להצגה מהסורק. אפשר להכין עסקה ידנית לבדיקה.', c.candidates, 'hint');
  for (const row of s.candidates) {const b = add('button', 'בדוק קנייה · ' + row.symbol, c.candidates, 'secondary'); b.type='button';
    b.addEventListener('click', () => {c.symbol.value=row.symbol; c.side.value='BUY'; c.side.dispatchEvent(new Event('change')); c.amount.focus();});
    add('small', 'איתות שנבדק: ' + at(row.at) + ' · בחירה אינה שולחת פקודה', c.candidates);}
}
async function refresh(platform) {
  if (busy[platform]) return; busy[platform]=true; render(platform);
  try {snapshots[platform] = await snapshot(platform);}
  catch (error) {snapshots[platform]=null; cards[platform].status.textContent=explain(error); cards[platform].details.replaceChildren();cards[platform].candidates.replaceChildren();}
  finally {busy[platform]=false; render(platform);}
}
function showResult(platform, result) {
  const text = result.text + ' · מזהה בקשה: ' + pending[platform]?.requestId;
  cards[platform].result.textContent=text; $('liveReviewResult').textContent=text;
  if (result.terminal) {try {remember(platform,null);} catch {cards[platform].result.textContent += ' · לא ניתן לנקות את מזהה הבקשה המקומי; אל תשלח שוב.';}}
  $('liveReviewCheck').hidden=!pending[platform]; render(platform);
}
async function check(platform) {
  if (!pending[platform] || busy[platform] || sending) return;
  busy[platform]=true; selectedPending=platform; render(platform);
  try {
    const body=pending[platform], response=platform==='BINANCE' ? await api(platform,'/api/binance-live/manual',{...body,statusOnly:true}) :
      await api(platform,'colmex-manual-trade?requestId='+encodeURIComponent(body.requestId));
    // NOT_RECORDED/unknown checks never clear the identity or resubmit an order.
    showResult(platform,reviewOutcome(platform,response.data,response.status));
  } catch {cards[platform].result.textContent='לא ניתן לאמת את תוצאת הבקשה. אל תשלח הוראה נוספת.';}
  finally {busy[platform]=false; render(platform);}
}
for (const [platform, config] of Object.entries(configs)) {
  try {const stored=JSON.parse(localStorage.getItem(config.pendingKey)||'null'); if (stored?.requestId) pending[platform]=stored;} catch {}
  const host=add('article','',$('liveCards'),'paper-card live-card'), h=add('div','',host,'section-heading');
  add('h3',config.name,h); add('span','LIVE · באישור שלך',h,'badge live-badge');
  const status=add('p','חבר מכשיר כדי לטעון מצב מאומת.',host,'paper-state');status.setAttribute('role','status');
  const link=add('a','חיבור מכשיר ופרטי החשבון ↗',host);link.href=config.href;
  const details=add('ul','',host,'hint'), automatic=add('p','',host,'hint');
  const refreshButton=add('button','רענן מצב חשבון',host,'secondary');refreshButton.type='button';refreshButton.addEventListener('click',()=>refresh(platform));
  const candidates=add('div','',host,'live-candidates');
  const form=add('form','',host,'live-form'), fields=add('div','',form,'fields');
  const field=(label,tag,type)=>{const l=add('label',label,fields),input=add(tag,'',l);if(type)input.type=type;input.required=true;return input;};
  const symbol=field('סימול הנכס','input','text');symbol.name='symbol';symbol.dir='ltr';symbol.placeholder=platform==='BINANCE'?'BTCUSDT':'AAPL';symbol.maxLength=24;
  const side=field('פעולה','select');side.name='side';for(const [value,label] of [['BUY','קנייה'],['SELL','מכירת כל הפוזיציה']]){const o=add('option',label,side);o.value=value;}
  const amount=field('סכום קנייה ב־'+config.currency,'input','number');amount.name='amount';amount.min=platform==='BINANCE'?'5':'0.01';amount.step='0.01';
  side.addEventListener('change',()=>{amount.disabled=side.value==='SELL';amount.required=side.value==='BUY';amount.parentElement.hidden=side.value==='SELL';});
  const limit=add('p','',form,'hint');
  const submit=add('button','הצג עסקה לאישור שלי',form,'wide');submit.type='submit';submit.disabled=true;
  const result=add('p',pending[platform]?'קיימת בקשה קודמת הממתינה לאימות. בדוק אותה לפני עסקה נוספת.':'טרם נשלחה עסקה ממסך זה.',host,'hint');result.setAttribute('role','status');
  const checkButton=add('button','בדוק תוצאת הבקשה הקודמת',host,'secondary');checkButton.type='button';checkButton.addEventListener('click',()=>check(platform));
  cards[platform]={host,status,details,automatic,candidates,symbol,side,amount,limit,submit,result,refresh:refreshButton,check:checkButton};
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy[platform]||pending[platform]||sending)return;
    const values={symbol:symbol.value,side:side.value,amount:amount.value};
    await refresh(platform);
    try {
      review=reviewInput(platform,values,snapshots[platform]);selectedPending=platform;
      $('liveReviewTitle').textContent=(review.side==='BUY'?'אישור קנייה אמיתית':'אישור מכירה אמיתית')+' · '+review.symbol+' · '+config.name;
      $('liveReviewSummary').textContent=review.side==='BUY'?'סכום קנייה: '+review.amount+' '+config.currency+' לפני עמלות. הכמות והמחיר הסופיים ייקבעו בביצוע פקודת שוק.':
        'מכירת כל הכמות הזמינה של '+review.symbol+' בעת ביצוע הבקשה. זו סגירת הפוזיציה, ולא מכירת כל התיק. עשויה להישאר שארית בגלל מגבלות הברוקר.';
      const s=snapshots[platform].settings;
      $('liveReviewProtection').textContent=review.side==='BUY'?'העסקה תיכנס לניהול ההגנות האוטומטי הקיים. הגדרות שנקראו כעת: סטופ '+(s?.stopLossPct??'—')+'%, יעד '+(s?.takeProfitPct??'—')+'%, הפעלת הגנה ב־'+(s?.profitActivationPct??'—')+'%. ההגדרות בשרת בזמן הביצוע קובעות; סטופ אינו מבטיח מחיר. קנייה ידנית זו אינה מחייבת איתות טכני.':
        'השרת יבדוק את הפוזיציה וההוראות הקיימות. בבייננס ההגנות שמנהל הבוט ישוחררו לפני מכירה. פקודת השוק אינה מבטיחה מחיר.';
      $('liveReviewResult').textContent='לא נשלחה הוראה. רק לחיצה על כפתור האישור הבא תשלח אותה בכסף אמיתי.';
      $('liveReviewConfirm').textContent=review.side==='BUY'?'אני מאשר קנייה בכסף אמיתי':'אני מאשר מכירה בכסף אמיתי';
      $('liveReviewConfirm').hidden=false;$('liveReviewConfirm').disabled=false;$('liveReviewCheck').hidden=true;
      $('liveReviewDialog').showModal();
    } catch(error) {result.textContent=explain(error);}
  });
  render(platform); if(token(platform))refresh(platform);
}
$('liveReviewConfirm').addEventListener('click',async()=>{
  if(!review||sending||pending[review.platform])return;
  const current=review,platform=current.platform;
  if(Date.now()-current.reviewedAt>REVIEW_MAX_AGE){$('liveReviewResult').textContent='עבר יותר מדקה מאז הבדיקה. סגור והכן את העסקה מחדש.';$('liveReviewConfirm').disabled=true;return;}
  sending=true;$('liveReviewConfirm').disabled=true;$('liveReviewCancel').disabled=true;
  try {
    // Capture exactly the reviewed fields. No UI change, poll or pairing sends this.
    const body=orderBody(current,crypto.randomUUID());remember(platform,body);review=null;
    $('liveReviewConfirm').hidden=true;render(platform);
    const response=await api(platform,platform==='BINANCE'?'/api/binance-live/manual':'colmex-manual-trade',body);
    showResult(platform,reviewOutcome(platform,response.data,response.status));
  } catch(error) {
    $('liveReviewResult').textContent=pending[platform]?'לא התקבלה תוצאה ודאית. אל תשלח שוב; בדוק את מצב אותה בקשה.':'מזהה הבקשה לא נשמר במכשיר. לא נשלחה הוראה.';
    cards[platform].result.textContent=$('liveReviewResult').textContent;
    $('liveReviewCheck').hidden=!pending[platform];
  } finally {sending=false;$('liveReviewCancel').disabled=false;render(platform);}
});
$('liveReviewCancel').addEventListener('click',()=>{if(!sending){$('liveReviewDialog').close();review=null;}});
$('liveReviewDialog').addEventListener('cancel',e=>{if(sending)e.preventDefault();else review=null;});
$('liveReviewCheck').addEventListener('click',()=>{if(selectedPending)check(selectedPending);});
setInterval(()=>{if(!document.hidden&&!sending&&!$('liveReviewDialog').open)for(const platform of Object.keys(configs))if(token(platform))refresh(platform);},60000);
