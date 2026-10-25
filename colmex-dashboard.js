import {stockScenario,protectionView,closedTradeSummary,marketHealthView} from './lib/colmex-dashboard-math.mjs';
import {monitorView} from './lib/colmex-monitor-view.mjs';
const $=id=>document.getElementById(id),txt=(id,value)=>{if($(id))$(id).textContent=value;};
const n=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('en-US',{maximumFractionDigits:2});
const price=v=>v>0?Number(v).toLocaleString('en-US',{maximumSignificantDigits:7}):'—';
const signed=v=>v===null||v===undefined?'—':(v>0?'+':'')+n(v);
const time=t=>t?new Date(t).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'טרם אומת';
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
let account=window.LEVI_COLMEX_ACCOUNT||null,status=window.LEVI_COLMEX_STATUS?.data||null,statusFailed=window.LEVI_COLMEX_STATUS?.error||false,market=window.LEVI_COLMEX_MARKET||null;
function health(id,kind,message){$(id).dataset.state=kind;$(id).textContent=message;}
function render(){
 const now=Date.now(),data=account?.data,fresh=data?.selectedAccount&&!account.error&&Date.parse(data.observedAt)<=now+5000&&now-Date.parse(data.observedAt)<180000;
 health('colmexAccountHealth',fresh?'good':account?.error?'warning':'unknown',fresh?'החשבון מעודכן':account?.error?'החשבון אינו מאומת':data?.selectionRequired?'יש לבחור חשבון בפירוט':'ממתין לנתוני חשבון');
 txt('colmexSnapshotAt',fresh?'חשבון '+(data.selectedAccount?.name||data.selectedAccount?.id||'נבחר')+' · '+time(data.observedAt):account?.error?'החיבור מתעכב · היתרה והפוזיציות אינן מאומתות כרגע':'הנתונים יופיעו עם קבלת תשובת הברוקר');
 const currency=data?.selectedAccount?.currency||'USD';txt('colmexEquityLabel','שווי החשבון · '+currency);txt('colmexCashLabel','מזומן בחשבון · '+currency);txt('colmexPnlLabel','רווח / הפסד פתוח נטו · '+currency);
 txt('colmexEquity',fresh?n(data.state?.projectedBalance??data.state?.balance):'—');txt('colmexCash',fresh?n(data.state?.cashBalance):'—');
 txt('colmexOpenPnl',fresh?signed(data.state?.openNetPnL):'—');$('colmexOpenPnl').dataset.sign=fresh&&Number(data.state?.openNetPnL)<0?'negative':'positive';
 txt('colmexSlotCount',fresh?(data.positions||[]).length+' / '+(status?.policy?.maxPositions||3):'—');
 $('colmexSlots').replaceChildren(...Array.from({length:status?.policy?.maxPositions||3},(_,i)=>el('i',null,fresh&&i<(data.positions||[]).length?'used':'')));
 const monitor=status&&!statusFailed?monitorView(status,now):null;
 health('colmexServerHealth',!monitor?'unknown':monitor.health==='recent'&&!status.pendingActions?.length?'good':'warning',!monitor?'מצב המעקב לא אומת':status.halt?'נדרש בירור פקודה':status.pendingActions?.length?'הוראה ממתינה לאישור':monitor.health==='recent'?'שרת המעקב פעיל':monitor.health==='disabled'?'המעקב כבוי':'עדכון השרת מתעכב');
 const marketHealth=marketHealthView(market,now);health('colmexMarketHealth',marketHealth.kind,marketHealth.label);
 txt('colmexPolicy',status?.policy?`${status.policy.symbols.length} מניות במעקב · עד $${status.policy.notionalUsd} למניה · ${status.policy.maxPositions} פוזיציות`:'50 מניות במעקב · עד $800 למניה · 3 פוזיציות');
 const prepared=!statusFailed&&status?.preparation?.rows||{},checked=Object.values(prepared).filter(r=>!r.error&&r.complete!==false).length,total=status?.policy?.symbols?.length||50;
 const pct=Math.min(100,checked/total*100);$('colmexScanRing').style.setProperty('--scan-angle',pct*3.6+'deg');txt('colmexScanCount',checked+' / '+total);
 txt('colmexScanNote',status&&!statusFailed?'הכנה לפי הנרות הסגורים · '+time(status.preparation?.lastCheckedAt):'ממתין לסיכום הסריקה');
 txt('colmexChecksCount',monitor?`${monitor.checked} / ${monitor.total}`:'—');
 txt('colmexProtectionAt',status&&!statusFailed?'בדיקת ברוקר אחרונה: '+time(status.lastBrokerSnapshotAt):'מצב ההגנות טרם אומת');
 const host=$('colmexPositionCards');host.replaceChildren();
 const positions=status?.positions||[];
 if(!status||statusFailed)host.append(el('p','ממתין לנתוני פוזיציות מנוהלות.','quiet-empty'));
 else if(!positions.length)host.append(el('p','אין פוזיציות מנוהלות בדיווח השרת. כלל ההחזקות מופיעות בפירוט החשבון.','quiet-empty'));
 else for(const p of positions){
  const protection=protectionView(p,status.pendingActions,now),card=el('article',null,'colmex-position');
  card.append(el('h3',p.symbol),el('span',protection.label,'protection-state '+protection.kind));
  const grid=el('div',null,'position-prices');
  for(const [label,value] of [['כמות',n(p.qty)],['כניסה','$'+price(p.entryPrice)],['מחיר שנצפה',p.lastQuoteAt&&now-p.lastQuoteAt<120000?'$'+price(p.lastBid):'—'],['סטופ מאושר',protection.stop>0?'$'+price(protection.stop):'—'],['יעד מאושר',protection.target>0?'$'+price(protection.target):'—'],['שיא שנצפה','$'+price(p.peakPrice)]]){const item=el('div');item.append(el('span',label),el('b',value));grid.append(item);}card.append(grid);
  card.append(el('p','נבדק: '+time(p.brokerProtection?.verifiedAt)+' · מחיר הביצוע עשוי להיות שונה.','small muted'));host.append(card);
 }
 const trades=status&&!statusFailed?status.closedTrades||[]:[],summary=closedTradeSummary(trades);
 txt('colmexClosedSummary',!status||statusFailed?'ממתין ליומן':!summary.count?'היומן יציג סגירות שיתועדו מעדכון זה ואילך.':`${summary.count} סגירות אחרונות · רווח גולמי ידוע: $${n(summary.gross)} מתוך ${summary.known} סגירות · נטו ממתין לאימות עמלות`);
 const rows=$('colmexClosedRows');rows.replaceChildren();
 for(const t of [...trades].reverse()){const row=el('tr');for(const value of [t.symbol,time(t.closedObservedAt),n(t.qty),price(t.entryPrice),price(t.exitPrice),t.accountingAdjusted?'כמות שונתה':signed(t.grossPnl),'לא אומת'])row.append(el('td',value));rows.append(row);}
}
window.addEventListener('levi:colmex-account',e=>{account=e.detail;render();});
window.addEventListener('levi-colmex-rsi',e=>{status=e.detail;statusFailed=false;render();});
window.addEventListener('levi:colmex-status-error',()=>{statusFailed=true;render();});
window.addEventListener('levi:colmex-market',e=>{market=e.detail;render();});
$('colmexCollapseAll').onclick=()=>document.querySelectorAll('main details[open]').forEach(d=>d.open=false);
$('colmexOpenChart').onclick=()=>{$('colmexChartPanel').open=true;$('colmexChartPanel').scrollIntoView({behavior:'smooth',block:'start'});};
$('colmexOpenAccount').onclick=()=>{$('colmexAccountDetails').open=true;$('colmexAccountDetails').scrollIntoView({behavior:'smooth',block:'start'});};
const marketPower=$('marketPowerSettingsPanel');if(marketPower)document.querySelector('#colmexChartPanel > .disclosure-content').append(marketPower);
const settings=$('openAppSettings');if(settings){$('colmexHeaderActions').append(settings);settings.textContent='⚙ הגדרות';}
function calculate(e){e?.preventDefault();const form=$('colmexScenario'),input=Object.fromEntries(new FormData(form)),r=stockScenario(input),host=$('colmexScenarioResults');host.replaceChildren();txt('colmexScenarioError',r.error||'');if(r.error)return;
 for(const [label,value,cls] of [['כמות מניות שלמות',n(r.quantity),''],['רווח ביעד אחרי העלויות שהוזנו','$'+signed(r.targetPnl),r.targetPnl>0?'positive':'negative'],['תוצאה בסטופ אחרי העלויות שהוזנו','$'+signed(r.stopPnl),'negative'],['מחיר איזון','$'+price(r.breakEven),''],['יחס רווח / סיכון',r.ratio===null?'אין רווח נטו ביעד':n(r.ratio)+' : 1',''],['עלות כולל עמלת קנייה','$'+n(r.debit),'']]){const item=el('article');item.append(el('span',label),el('strong',value,cls));host.append(item);}}
$('colmexScenario').addEventListener('submit',calculate);
$('colmexScenario').addEventListener('input',()=>{$('colmexScenarioResults').replaceChildren();txt('colmexScenarioError','הזן את התרחיש ולחץ על חשב.');});
render();setInterval(()=>{if(!document.hidden)render();},15000);
