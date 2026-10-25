import {validateSnapshot, connectionState, protectionLabel, reservedSymbols, modeNames, reasonNames} from './lib/crawler-view.mjs';
const $ = id => document.getElementById(id);
const endpoint = '/.netlify/functions/meitav-crawler';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = (value, digits=2) => Number.isFinite(value) ? value.toLocaleString('he-IL',{maximumFractionDigits:digits}) : '—';
const money = value => Number.isFinite(value) ? num(value)+' $' : '—';
const pct = value => Number.isFinite(value) ? num(value)+'%' : '—';
const color = value => Number.isFinite(value) ? value > 0 ? 'positive' : value < 0 ? 'negative' : '' : '';
const time = ms => Number.isFinite(ms) && ms > 0 ? new Date(ms).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '—';
const yes = value => value === true ? 'פעיל' : value === false ? 'כבוי' : '—';
const pair = (label,value) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
let snapshot = null, health = null, receivedAt = 0, timer, busy = false, signedIn = false, epoch = 0;
async function request(action, body) {
  const response = await fetch(endpoint+'?action='+encodeURIComponent(action),{method:body ? 'POST' : 'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15_000),headers:body ? {'Content-Type':'application/json'} : {},...(body ? {body:JSON.stringify(body)} : {})});
  let data;try { data=await response.json(); } catch {throw Error('החיבור לבוט אינו זמין בכתובת האתר הנוכחית.');}
  if(!response.ok) {const error=Error(data.error || 'לא ניתן לקרוא נתונים');error.status=response.status;throw error;}
  return data;
}
function notice(message) {$('notice').hidden=!message;$('notice').textContent=message || '';}
function connection() {
  const state=connectionState(snapshot,health,receivedAt);
  $('connectionTitle').textContent=state.label;
  $('connectionDot').classList.toggle('connected',state.current);
  document.body.classList.toggle('stale',Boolean(snapshot)&&!state.current);
  if(snapshot) $('connectionDetail').textContent=state.current ? 'קריאה משרת הבוט כל 15 שניות בזמן שהמסך פתוח. אין משלוח פקודות מהמסך.' : 'התצוגה כוללת נתונים אחרונים בלבד. אין אישור שהמנוע פועל כעת.';
}
function renderRadar() {
  if(!snapshot)return;
  const q=$('search').value.trim().toUpperCase();
  const rows=snapshot.radar.filter(r=>String(r.symbol).includes(q));
  $('radarCount').textContent=rows.length+' ברשימה';
  $('radar').innerHTML=rows.length ? rows.map(r=>`<tr><td><b>${esc(r.symbol)}</b></td><td>${Number.isFinite(r.progress)?pct(Math.max(0,r.progress)*100):'—'}</td><td>${esc(r.note || (r.regime==='uptrend'?'מגמת עלייה':r.regime==='downtrend'?'מגמת ירידה':'ממתין'))}</td></tr>`).join('') : '<tr><td colspan="3">אין מטבעות ברשימת הרדאר התואמים לחיפוש.</td></tr>';
}
function render(s) {
  const d=s.day, st=s.settings;
  $('equity').textContent=money(s.equity);$('dayTotal').textContent=money(d.total);$('dayTotal').className=color(d.total);
  $('dayBreakdown').textContent=`נסגרו: ${money(d.realized)} · פתוחות: ${money(d.open)}`;
  $('slots').textContent=`${reservedSymbols(s)} / ${num(st.max_positions,0)}`;$('available').textContent=money(s.available);
  $('dayDate').textContent='יום החשבון: '+(d.date || '—');$('dayTarget').textContent=money(d.target);
  $('dayLoss').textContent=Number.isFinite(d.loss_limit)?money(-d.loss_limit):'—';$('dayFees').textContent=money(d.fees);
  $('dayProgress').value=Number.isFinite(d.total)&&d.target>0 ? Math.max(0,Math.min(100,100*d.total/d.target)) : 0;
  const locks={loss:'מגבלת הפסד יומית',kill:'עצירה יומית',target:'היעד הושג — כניסות נעצרו',floor:'הרווח ירד לסף העצירה'};
  $('dayStatus').textContent=locks[d.lock] || (s.paused?'כניסות מושהות':d.target_reached?'היעד הושג':'מעקב פעיל');
  $('dayExplanation').textContent=d.lock ? 'המנוע חסם כניסות חדשות. בדוק את העסקאות הפתוחות ואת היומן.' : d.target_reached && st.after_target==='keep_half' ? `המשך בחצי גודל; כניסות חדשות ייעצרו אם רווח היום ירד ל־${money(d.floor)}.` : `יעד היום: ${money(d.target)}. מגבלת ההפסד היומית: ${money(d.loss_limit)}.`;
  $('mode').textContent=modeNames[s.mode];$('mode').className=s.real_money?'warning':'';
  $('engineVersion').textContent='גרסת שרת: '+s.version;
  $('engineInfo').innerHTML=pair('פעילות',s.paused?'כניסות מושהות':s.status)+pair('חסם כניסה',s.block || 'אין חסם מדווח')+pair('זמן פעימת המנוע',health?.tick_age_s == null?'לא אומת':num(health.tick_age_s)+' שניות')+pair('תאריך נתוני המנוע',time(s.now))+pair('חיבור התראות מהבורסה',s.stream?.state || 'לא דווח');
  $('positionsCount').textContent=s.positions.length+' פתוחות';
  $('positions').innerHTML=s.positions.length ? s.positions.map(p=>{
    const stage={initial:'העסקה לפני מימוש חלקי',tp1_banked:'חלק מהעסקה מומש',protected:'היתרה סביב מחיר איזון'}[p.stage] || p.stage;
    const values=[['כניסה',num(p.entry,8)],['מחיר אחרון',num(p.mark,8)],['כמות',num(p.qty,8)],['עצירת הפסד',num(p.stop_price,8)],['מימוש חלקי · TP1',num(p.tp1_price,8)],['יעד סופי · TP2',num(p.target_price,8)]];
    return `<article class="position"><div class="position-head"><div><b>${esc(p.symbol)}</b><div class="position-stage">${p.direction>0?'לונג · רווח מעלייה':'שורט · רווח מירידה'} · מינוף ×${esc(num(p.leverage,0))}</div></div><strong class="${color(p.net)}">${money(p.net)}</strong></div><div class="position-details">${values.map(([label,value])=>`<div><span>${label}</span><b>${esc(value)}</b></div>`).join('')}</div><div class="position-foot">${esc(protectionLabel(p))}<div class="position-stage">${esc(stage)} · ${num(p.age_min,0)} דקות</div><div class="position-stage">תוצאה משוערת בסף ההגנה: <span class="${color(p.worst_case)}">${money(p.worst_case)}</span>. קפיצת מחיר עלולה להגדיל הפסד.</div></div></article>`;
  }).join('') : '<div class="empty">המנוע מדווח שאין עסקאות מנוהלות פתוחות.</div>';
  $('reservations').innerHTML=[['עסקאות מחוץ לניהול המנוע — יש לבדוק הגנה ביומן',s.orphans],['כניסה שטרם התקבל לה אישור',s.pending],['ממתינים לסגירת דקה בכיוון העסקה',s.waiting]].filter(([,rows])=>rows.length).map(([label,rows])=>`<div class="reservation"><b>${esc(label)}</b>: ${rows.map(p=>esc(p.symbol)).join(', ')}</div>`).join('');
  renderRadar();
  $('events').innerHTML=s.events.length ? s.events.slice(0,30).map(e=>`<li><time>${time(e.ts)}</time><span class="${e.level==='error'?'negative':e.level==='warning'?'warning':''}">${esc(e.msg)}</span></li>`).join('') : '<li class="muted">אין אירועים ביומן שהתקבל.</li>';
  $('trades').innerHTML=s.trades?.length ? s.trades.slice(0,30).map(t=>`<tr><td>${time(t.closed_ms)}</td><td><b>${esc(t.symbol)}</b></td><td>${t.side==='LONG'?'לונג · עלייה':'שורט · ירידה'}</td><td>${esc(reasonNames[t.reason] || t.reason)}${t.tp1?' · מימוש חלקי':''}</td><td class="${color(t.net)}" dir="ltr">${money(t.net)}</td></tr>`).join('') : '<tr><td colspan="5">אין עסקאות סגורות בהיסטוריה שהתקבלה.</td></tr>';
  $('settings').innerHTML=[['סיכון בסיסי לעסקה',pct(st.risk_per_trade_pct)],['מכפיל סיכון מרבי',num(st.max_bet)+'×'],['מינוף מרבי',num(st.max_leverage,0)+'×'],['עסקאות במקביל',num(st.max_positions,0)],['עסקאות באותו כיוון',num(st.max_same_direction,0)],['ממתינים לאישור דקה',yes(st.confirm_entry)],['מספר מטבעות בגל',num(st.min_crowd,0)],['יעד מול עלות משוערת',num(st.min_edge_x)+'×'],['מימוש חלקי מהכמות',pct(st.tp1_share_pct)],['מגבלת זמן לעסקה',num(st.max_hold_minutes,0)+' דקות'],['Flush Fade',yes(st.flush_on)],['Spring Reclaim',yes(st.spring_on)]].map(([label,value])=>pair(label,value)).join('');
  $('lastUpdated').textContent='הנתונים התקבלו: '+time(receivedAt)+' · שעון ישראל';
  notice(s.fatal || s.error || '');connection();
}
function schedule() {clearTimeout(timer);if(signedIn&&!document.hidden)timer=setTimeout(refresh,15_000);}
async function refresh() {
  if(busy || !signedIn || document.hidden)return;
  busy=true;const generation=epoch;
  try {
    const result=await request('snapshot');
    if(generation!==epoch)return;
    snapshot=validateSnapshot(result.snapshot);health=result.health;receivedAt=Date.now();
    $('connectPanel').hidden=true;$('logout').hidden=false;render(snapshot);
  } catch(e) {
    if(generation!==epoch)return;
    health={ok:false};connection();notice(e.message);
    if(e.status===401) {signedIn=false;clearTimeout(timer);$('connectPanel').hidden=false;$('loginForm').hidden=false;$('connectMessage').textContent='נדרשת כניסה עם קוד הגישה של הבוט.';}
  } finally {busy=false;schedule();}
}
async function initialize() {
  $('refresh').disabled=true;notice('');
  try {
    const config=await request('config');
    if(config.protocol!=='crypto_crawler' || config.readOnly!==true)throw Error('חיבור התצוגה אינו מזוהה.');
    $('setupHelp').hidden=config.configured;$('loginForm').hidden=!config.configured;
    $('connectPanel').hidden=false;
    if(!config.configured) {
      $('connectionTitle').textContent='ממתין לחיבור שרת הבוט';
      $('connectionDetail').textContent='הממשק מוכן. טרם הוגדר שרת crypto_crawler להצגת נתונים.';
      $('connectMessage').textContent='יש להגדיר כתובת שרת של הבוט החדש. אין כרגע נתוני חשבון או עסקאות מאומתים.';
      return;
    }
    $('connectMessage').textContent='הזן את קוד הבוט. הקוד אינו נשמר בדפדפן.';signedIn=true;await refresh();
  } catch(e) {$('connectionTitle').textContent='החיבור אינו זמין';$('connectMessage').textContent=e.message;notice(e.message);}
  finally {$('refresh').disabled=false;}
}
$('loginForm').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.submitter;button.disabled=true;$('loginError').textContent='';
  try {await request('login',{pin:$('pin').value});$('pin').value='';signedIn=true;await refresh();}
  catch(e) {$('loginError').textContent=e.message;$('pin').value='';}
  finally {button.disabled=false;}
});
$('logout').addEventListener('click',async()=>{
  epoch++;signedIn=false;clearTimeout(timer);$('logout').disabled=true;
  try {await request('logout',{});location.reload();}
  catch(e){notice(e.message);$('logout').disabled=false;}
});
$('refresh').addEventListener('click',()=>signedIn?refresh():initialize());
$('search').addEventListener('input',renderRadar);
document.addEventListener('visibilitychange',()=>{clearTimeout(timer);connection();if(!document.hidden&&signedIn)refresh();});
initialize();
