import {monitorView} from './lib/colmex-monitor-view.mjs';
const badge=document.getElementById('autoLiveBadge'),status=document.getElementById('autoLiveStatus'),positions=document.getElementById('autoLivePositions'),checks=document.getElementById('autoLiveChecks');
const health=document.getElementById('autoMonitorHealth'),summary=document.getElementById('autoMonitorSummary'),received=document.getElementById('autoMonitorReceived'),refreshButton=document.getElementById('autoMonitorRefresh');
let latest=null,loading=false;
const labels={CYCLE_ERROR:'הסבב נכשל · נדרשת בדיקה',DISABLED:'כבוי · לא נשלחות הוראות',REQUIRES_REVIEW:'נעצר לבדיקת הוראה אצל הברוקר',PENDING_BROKER_CONFIRMATION:'ממתין לאישור ביצוע מהברוקר',MONITORING:'המעקב האוטומטי מופעל',WAITING_FIRST_CYCLE:'ממתין לסבב הראשון',STATUS_UNAVAILABLE:'לא ניתן לאמת מצב כרגע'};
const reasons={WAIT_RSI_0_30:'ממתין ל־RSI חי בין 0 ל־30 בנקודת Spring',WAIT_RSI_DATA:'אין מספיק נרות לחישוב RSI (14)',WAIT_FRESH_PRICE:'ממתין למחיר חי עדכני',PATTERN_ALREADY_USED:'תבנית וואיקוף כבר נוצלה · ממתין לחדשה',NO_FREE_SLOT:'כל שלוש הפוזיציות תפוסות',BROKER_BRACKET_PERMISSION_REQUIRED:'נדרשת הרשאת מסחר והוראות הגנה אצל הברוקר',WAIT_NEXT_CYCLE:'ממתין לשעות המסחר או לסבב הבא',CYCLE_DEADLINE:'הבדיקה נדחתה לסבב הבא',INSTRUMENT_UNAVAILABLE_OR_AMBIGUOUS:'המניה אינה זמינה או שיש כמה זירות מסחר',MINIMUM_QUANTITY_ABOVE_BUDGET:'הכמות המינימלית יקרה מ־800 דולר',UNKNOWN_QUANTITY_RULES:'לא התקבלו מגבלות כמות תקינות',INSUFFICIENT_UNLEVERAGED_CASH:'אין די מזומן זמין כולל רזרבה',EXISTING_POSITION_OR_ORDER:'כבר קיימת פוזיציה או הוראה במניה',WAIT_BROKER_QUOTE:'ממתין לציטוט תקין מהברוקר',WAIT_CURRENT_5M_BARS:'ממתין לנרות עדכניים',WAIT_NEW_WYCKOFF_SIGNAL:'ממתין לתבנית וואיקוף חדשה',SIGNAL_PRICE_INVALIDATED:'המחיר כבר אינו מתאים לאישור',UNSUPPORTED_INSTRUMENT:'הנכס או מצב המסחר אינו נתמך',OUTSIDE_REGULAR_SESSION:'מחוץ לשעות המסחר הרגילות',WAIT_WYCKOFF:'ממתין לוואיקוף',SEARCH_PEAK:'מחפש שיא ראשוני',FIRST_LOW:'מחפש שפל ראשון',RALLY_HIGH:'מחפש שיא התאוששות',SECONDARY_TEST:'ממתין לבדיקה חוזרת',CONSOLIDATION:'ממתין להשלמת דשדוש',SPRING:'בודק Spring',READY:'עבר את בדיקות הכניסה',PENDING_BROKER_CONFIRMATION:'ממתין לאישור ביצוע מהברוקר'};
const reason=r=>reasons[r]||r;
const time=t=>t?new Date(t).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}):'טרם בוצעה בדיקה';
function line(parent,text){const p=document.createElement('p');p.textContent=text;parent.append(p);}
function renderMonitor(){
 if(!latest)return;
 const view=monitorView(latest);
 const messages={disabled:'המעקב כבוי בשרת',error:'תקלה או עצירה · יש לבדוק את מצב השרת',waiting:'טרם תועד סבב שהושלם',stale:'לא תועד סבב שהושלם בחמש הדקות האחרונות',recent:'התקבל סבב שרת שהושלם לאחרונה'};
 health.textContent=messages[view.health];health.dataset.health=view.health;
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
 if(typeof CustomEvent==='function')window.dispatchEvent(new CustomEvent('levi-colmex-rsi',{detail:d}));
 latest=d;received.textContent='מצב השרת נקרא במסך: '+time(Date.now());document.getElementById('autoMonitorHistory').replaceChildren();renderMonitor();
 badge.textContent=labels[d.status]||d.status;status.textContent=(d.enabled?'חשבון אמיתי · ':'ההפעלה טרם אושרה בשרת · ')+time(d.lastCompletedAt||d.lastCycleAt)+(!d.lastError&&d.lastResult?' · '+reason(d.lastResult):'')+(d.halt?' · '+d.halt:'')+(d.lastError?' · '+(d.lastError.reason==='NETWORK'?'קריאת קולמקס נכשלה או חרגה מזמן ההמתנה':d.lastError.reason==='AUTH_DENIED'?'קולמקס דחתה את פרטי החיבור':'שגיאת שרת: '+d.lastError.reason)+' · ניסיון אחרון: '+time(d.lastError.at):'');
 positions.replaceChildren();for(const p of d.positions||[])line(positions,`${p.symbol} · כמות ${p.qty} · כניסה $${p.entryPrice} · שיא שנצפה $${p.peakPrice}`);
 if(!d.positions?.length)line(positions,'אין פוזיציות שמנוהלות בידי המנגנון הזה. פוזיציות ידניות מוצגות בחלונית החשבון.');
 }catch{latest=null;badge.textContent='מצב לא זמין';status.textContent='לא ניתן לאמת אם המסחר מופעל. יש לבדוק את השרת.';health.textContent='אין חיבור לתצוגת המעקב · לא ניתן לאמת שהבדיקות ממשיכות';health.dataset.health='error';summary.textContent='זמן הסבב האחרון אינו מאומת כעת.';positions.replaceChildren();checks.replaceChildren();document.getElementById('autoMonitorHistory').replaceChildren();}finally{loading=false;refreshButton.disabled=false;}}
refreshButton.addEventListener('click',refresh);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
refresh();setInterval(refresh,60000);setInterval(renderMonitor,30000);
