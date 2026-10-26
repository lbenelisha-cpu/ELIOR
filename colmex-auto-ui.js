import {entryReasonLabel as reason} from './lib/colmex-entry-reasons.mjs?v=20261026-quality';
import {monitorView} from './lib/colmex-monitor-view.mjs';
const badge=document.getElementById('autoLiveBadge'),status=document.getElementById('autoLiveStatus'),positions=document.getElementById('autoLivePositions'),checks=document.getElementById('autoLiveChecks');
const health=document.getElementById('autoMonitorHealth'),summary=document.getElementById('autoMonitorSummary'),received=document.getElementById('autoMonitorReceived'),refreshButton=document.getElementById('autoMonitorRefresh');
let latest=null,loading=false;
const labels={CYCLE_ERROR:'הסבב נכשל · נדרשת בדיקה',DISABLED:'כבוי · לא נשלחות הוראות',REQUIRES_REVIEW:'נעצר לבדיקת הוראה אצל הברוקר',PENDING_BROKER_CONFIRMATION:'ממתין לאישור ביצוע מהברוקר',MONITORING:'המעקב האוטומטי מופעל',WAITING_FIRST_CYCLE:'ממתין לסבב הראשון',STATUS_UNAVAILABLE:'לא ניתן לאמת מצב כרגע'};

const time=t=>t?new Date(t).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}):'טרם בוצעה בדיקה';
function line(parent,text){const p=document.createElement('p');p.textContent=text;parent.append(p);}
function renderPreparation(){
 const root=document.getElementById('preparationRows'),summary=document.getElementById('preparationSummary');if(!root||!summary)return;
 const p=latest?.preparation,rows=p?.rows||{},symbols=latest?.policy?.symbols||[];
 const good=symbols.filter(s=>rows[s]&&!rows[s].error).length,candidates=symbols.filter(s=>rows[s]?.candidate);
 summary.textContent=`${good} מתוך ${symbols.length} מניות נותחו · ${candidates.length} מועמדות לפי הנר האחרון · ניתוח הכנה בלבד`+(p?.lastCheckedAt?' · בדיקה אחרונה: '+time(p.lastCheckedAt):' · ממתין לסריקה מחוץ לשעות המסחר');
 root.replaceChildren();
 for(const symbol of symbols){
  const r=rows[symbol],tr=document.createElement('tr');
  tr.dataset.state=r?.error||r?.complete===false?'old':r?'checked':'unseen';
  for(const value of [symbol,r?(r.reason==='WAIT_RSI_0_40'?'RSI בסגירה מחוץ לטווח 0–40':r.reason==='WAIT_RSI_0_30'?'RSI בסגירה מחוץ לטווח 0–30':reason(r.error||r.reason)):'ממתין לסריקת הכנה',Number.isFinite(r?.rsi)?r.rsi.toFixed(2):'—',r?.dataAt?time(r.dataAt):'—',r?.checkedAt?time(r.checkedAt):'—']){const td=document.createElement('td');td.textContent=value;tr.append(td);}
  root.append(tr);
 }
}
function renderMonitor(){
 if(!latest)return;
 renderPreparation();
 const view=monitorView(latest);
 const messages={disabled:'המעקב כבוי בשרת',error:'תקלה או עצירה · יש לבדוק את מצב השרת',waiting:'טרם תועד סבב שהושלם',stale:'לא תועד סבב שהושלם בחמש הדקות האחרונות',recent:'התקבל סבב שרת שהושלם לאחרונה'};
 health.textContent=messages[view.health]+(latest.lastResult==='OUTSIDE_REGULAR_SESSION'?' · השוק סגור; ניתוח ההכנה מוצג בטבלה הנפרדת':'');health.dataset.health=view.health;
 summary.textContent=`סבב שרת אחרון שהושלם: ${time(view.completed)} · ${view.age===null?'':`לפני ${Math.floor(view.age/60000)} דקות · `}תועדה בדיקה ל־${view.checked} מתוך ${view.total} מניות`;
 checks.replaceChildren();
 for(const row of view.rows){
  const tr=document.createElement('tr');tr.dataset.state=row.state;
  for(const value of [row.symbol,row.reason?reason(row.reason)+(row.entryRsi!==null?' · RSI '+row.entryRsi.toFixed(2):''):'טרם תועדה בדיקת כניסה',time(row.at),row.state==='old'?'בדיקה מלפני יותר מ־30 דקות':row.state==='unseen'?'ממתין לבדיקה מתועדת':'בדיקה מתועדת']){
   const td=document.createElement('td');td.textContent=value;tr.append(td);
  }
  checks.append(tr);
 }
 document.getElementById('autoMonitorHistory').replaceChildren();
 if(latest.historyQuality?.discarded)line(document.getElementById('autoMonitorHistory'),`${latest.historyQuality.symbol} · החיפוש התחיל מחדש לאחר פער בהיסטוריה · ${latest.historyQuality.usableBars} נרות רצופים זמינים`);
}
async function refresh(){if(document.hidden||loading)return;loading=true;refreshButton.disabled=true;try{
 const r=await fetch('/.netlify/functions/colmex-auto-status',{cache:'no-store',signal:AbortSignal.timeout(20000)});const d=await r.json();if(!r.ok)throw Error();
 if(typeof window!=='undefined')window.LEVI_COLMEX_STATUS={data:d,error:false};
 if(typeof CustomEvent==='function')window.dispatchEvent(new CustomEvent('levi-colmex-rsi',{detail:d}));
 latest=d;received.textContent='מצב השרת נקרא במסך: '+time(Date.now());document.getElementById('autoMonitorHistory').replaceChildren();renderMonitor();
 badge.textContent=labels[d.status]||d.status;status.textContent=(d.enabled?'חשבון אמיתי · ':'ההפעלה טרם אושרה בשרת · ')+time(d.lastCompletedAt||d.lastCycleAt)+(!d.lastError&&d.lastResult?' · '+reason(d.lastResult):'')+(d.halt?' · '+d.halt:'')+(d.lastError?' · '+(d.lastError.reason==='NETWORK'?'קריאת קולמקס נכשלה או חרגה מזמן ההמתנה':d.lastError.reason==='AUTH_DENIED'?'קולמקס דחתה את פרטי החיבור':'שגיאת שרת: '+d.lastError.reason)+' · ניסיון אחרון: '+time(d.lastError.at):'');
 positions.replaceChildren();for(const p of d.positions||[])line(positions,`${p.symbol} · כמות ${p.qty} · כניסה $${p.entryPrice} · שיא שנצפה $${p.peakPrice}`);
 if(!d.positions?.length)line(positions,'אין פוזיציות שמנוהלות בידי המנגנון הזה. פוזיציות ידניות מוצגות בחלונית החשבון.');
 }catch{if(typeof window!=='undefined')window.LEVI_COLMEX_STATUS={data:null,error:true};if(typeof CustomEvent==='function')window.dispatchEvent(new CustomEvent('levi:colmex-status-error'));latest=null;badge.textContent='מצב לא זמין';status.textContent='לא ניתן לאמת אם המסחר מופעל. יש לבדוק את השרת.';health.textContent='אין חיבור לתצוגת המעקב · לא ניתן לאמת שהבדיקות ממשיכות';health.dataset.health='error';summary.textContent='זמן הסבב האחרון אינו מאומת כעת.';positions.replaceChildren();checks.replaceChildren();document.getElementById('autoMonitorHistory').replaceChildren();}finally{loading=false;refreshButton.disabled=false;}}
refreshButton.addEventListener('click',refresh);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
refresh();setInterval(refresh,60000);setInterval(renderMonitor,30000);
