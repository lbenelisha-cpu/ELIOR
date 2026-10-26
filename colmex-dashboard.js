import {stockScenario,protectionView,closedTradeSummary,marketHealthView} from './lib/colmex-dashboard-math.mjs';
import {monitorView} from './lib/colmex-monitor-view.mjs';
import {positionChangeBadge} from './position-map-change.js?v=20261026-position-side';
const $=id=>document.getElementById(id),txt=(id,value)=>{if($(id))$(id).textContent=value;};
const n=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('en-US',{maximumFractionDigits:2});
const price=v=>v>0?Number(v).toLocaleString('en-US',{maximumSignificantDigits:7}):'—';
const signed=v=>v===null||v===undefined?'—':(v>0?'+':'')+n(v);
const time=t=>t?new Date(t).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'טרם אומת';
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
let account=window.LEVI_COLMEX_ACCOUNT||null,status=window.LEVI_COLMEX_STATUS?.data||null,statusFailed=window.LEVI_COLMEX_STATUS?.error||false,market=window.LEVI_COLMEX_MARKET||null;
let selectedPosition=null,scenarioCalculated=false;
const freshAt=(at,now,maxAge)=>Number.isFinite(Number(at))&&Number(at)>0&&Number(at)<=now+5000&&now-Number(at)<=maxAge;
function openPanel(id){const panel=$(id);panel.open=true;panel.scrollIntoView({behavior:'smooth',block:'start'});}
function openPositionChart(symbol){openPanel('colmexChartPanel');window.dispatchEvent(new CustomEvent('levi-rsi-select',{detail:symbol}));}
function renderMap(now){
 const positions=!statusFailed&&status?.positions||[],select=$('colmexMapSelect'),host=$('colmexMapContent');
 const key=positions.map(p=>p.symbol).join('|');
 if(select.dataset.options!==key){select.replaceChildren(...positions.map(p=>{const option=el('option',p.symbol);option.value=p.symbol;return option;}));select.dataset.options=key;}
 if(!positions.some(p=>p.symbol===selectedPosition))selectedPosition=positions[0]?.symbol||null;
 select.value=selectedPosition||'';select.hidden=positions.length<2;host.replaceChildren();
 const p=positions.find(p=>p.symbol===selectedPosition);$('colmexMapChart').hidden=!p;
 txt('colmexMapTitle',p?.symbol||'מפת פוזיציה');
 if(!p){const empty=el('div',null,'map-empty');empty.append(el('div',null,'empty-rail'),el('p',!status||statusFailed?'ממתין לנתוני הפוזיציות.':account?.data?.positions?.length?'ההחזקות מופיעות בפרטי החשבון. המפה תוצג לפוזיציה שבמעקב האוטומטי.':'אין כרגע פוזיציה במעקב האוטומטי.\nכשתיפתח פוזיציה, רמות המחיר יוצגו כאן.'));host.append(empty);return;}
 const protection=protectionView(p,status.pendingActions,now),entry=Number(p.entryPrice)>0?Number(p.entryPrice):null,current=freshAt(p.lastQuoteAt,now,120000)&&Number(p.lastBid)>0?Number(p.lastBid):null;
 host.append(positionChangeBadge(el,entry,current));
 const stop=protection.stop>0?protection.stop:null,target=protection.target>0?protection.target:null;
 const grid=el('div',null,'position-prices');
 for(const [label,value,cls] of [['כניסה',entry,''],['מחיר שנצפה',current,''],['סטופ מאושר',stop,'negative'],['יעד מאושר',target,'positive']]){const item=el('div');item.append(el('span',label),el('b',value===null?'—':'$'+price(value),cls));grid.append(item);}host.append(grid);
 const points=[[stop,'stop'],[entry,'entry'],[current,'current'],[target,'target']].filter(([v])=>v!==null),values=points.map(([v])=>v),lo=Math.min(...values),hi=Math.max(...values);
 if(points.length>=2&&hi>lo){const rail=el('div',null,'price-rail');rail.setAttribute('role','img');rail.setAttribute('aria-label',`מפת מחירים: כניסה ${price(entry)}, מחיר שנצפה ${price(current)}, סטופ מאושר ${price(stop)}, יעד מאושר ${price(target)}`);for(const [v,kind] of points){const dot=el('i',null,'price-marker '+kind);dot.style.setProperty('--marker',(v-lo)/(hi-lo)*100+'%');rail.append(dot);}host.append(rail);}
 if(current&&stop)host.append(el('p','מרחק מהמחיר שנצפה: סטופ '+signed((stop/current-1)*100)+'%'+(target?' · יעד '+signed((target/current-1)*100)+'%':''),'map-distances'));
 host.append(el('p',protection.label,'map-note '+(protection.kind==='good'?'positive':'')),el('small',current?'קריאת מחיר: '+time(p.lastQuoteAt)+' · ייתכן עיכוב אצל הספק.':'מחיר עדכני טרם התקבל · רמות המחיר האחרות מוצגות לפי זמן האימות שלהן.'));
}
function health(id,kind,message){$(id).dataset.state=kind;$(id).textContent=message;}
function render(){
 const now=Date.now(),data=account?.data,fresh=data?.selectedAccount&&!account.error&&Date.parse(data.observedAt)<=now+5000&&now-Date.parse(data.observedAt)<180000;
 health('colmexAccountHealth',fresh?'good':account?.error?'warning':'unknown',fresh?'החשבון מעודכן':account?.error?'החשבון אינו מאומת':data?.selectionRequired?'יש לבחור חשבון בפירוט':'ממתין לנתוני חשבון');
 txt('colmexSnapshotAt',fresh?'חשבון '+(data.selectedAccount?.name||data.selectedAccount?.id||'נבחר')+' · '+time(data.observedAt):account?.error?'החיבור מתעכב · היתרה והפוזיציות אינן מאומתות כרגע':'הנתונים יופיעו עם קבלת תשובת הברוקר');
 const currency=data?.selectedAccount?.currency||'USD';txt('colmexEquityLabel','שווי החשבון · '+currency);txt('colmexCashLabel','מזומן בחשבון · '+currency);txt('colmexPnlLabel','רווח / הפסד פתוח נטו · '+currency);
 txt('colmexMode',!data?.selectedAccount?'חשבון ברוקר':data.selectedAccount.type==='demo'?'DEMO · חשבון דמו':data.selectedAccount.type==='live'?'LIVE · חשבון אמיתי':'חשבון מחובר');
 txt('colmexEquity',fresh?n(data.state?.projectedBalance??data.state?.balance):'—');txt('colmexCash',fresh?n(data.state?.cashBalance):'—');
 txt('colmexOpenPnl',fresh?signed(data.state?.openNetPnL):'—');$('colmexOpenPnl').dataset.sign=!fresh||!Number(data.state?.openNetPnL)?'unknown':Number(data.state.openNetPnL)<0?'negative':'positive';
 txt('colmexSlotCount',fresh?(data.positions||[]).length+' / '+(status?.policy?.maxPositions||3):'—');
 $('colmexSlots').replaceChildren(...Array.from({length:status?.policy?.maxPositions||3},(_,i)=>el('i',null,fresh&&i<(data.positions||[]).length?'used':'')));
 const monitor=status&&!statusFailed?monitorView(status,now):null;
 health('colmexServerHealth',!monitor?'unknown':monitor.health==='recent'&&!status.pendingActions?.length?'good':'warning',!monitor?'מצב המעקב לא אומת':status.halt?'נדרש בירור פקודה':status.pendingActions?.length?'הוראה ממתינה לאישור':monitor.health==='recent'?'שרת המעקב פעיל':monitor.health==='disabled'?'המעקב כבוי':'עדכון השרת מתעכב');
 const marketHealth=marketHealthView(market,now);health('colmexMarketHealth',marketHealth.kind,marketHealth.label);
 txt('colmexPolicy',status?.policy?`${status.policy.symbols.length} מניות במעקב · עד $${status.policy.notionalUsd} למניה · ${status.policy.maxPositions} פוזיציות`:'50 מניות במעקב · עד $800 למניה · 3 פוזיציות');
 const prepared=!statusFailed&&status?.preparation?.rows||{},checked=Object.values(prepared).filter(r=>!r.error&&r.complete!==false).length,total=status?.policy?.symbols?.length||50;
 const pct=Math.min(100,checked/total*100);$('colmexScanRing').style.setProperty('--scan-angle',pct*3.6+'deg');txt('colmexScanCount',(status&&!statusFailed?checked:'—')+' / '+total);
 txt('colmexScanNote',status&&!statusFailed?'הכנה לפי הנרות הסגורים · '+time(status.preparation?.lastCheckedAt):'ממתין לסיכום הסריקה');
 txt('colmexChecksCount',monitor?`${monitor.checked} / ${monitor.total}`:'—');
 txt('colmexProtectionAt',status&&!statusFailed?'בדיקת ברוקר אחרונה: '+time(status.lastBrokerSnapshotAt):'מצב ההגנות טרם אומת');
 const host=$('colmexPositionCards');host.replaceChildren();
 const positions=status?.positions||[];
 txt('colmexPositionsSummary',!status||statusFailed?'ממתין לנתוני המעקב':positions.length?`${positions.length} פוזיציות מנוהלות · לחץ לצפייה בכמות ובהגנות`:'אין פוזיציות במעקב האוטומטי');
 renderMap(now);
 if(!status||statusFailed)host.append(el('p','ממתין לנתוני פוזיציות מנוהלות.','quiet-empty'));
 else if(!positions.length)host.append(el('p','אין פוזיציות מנוהלות בדיווח השרת. כלל ההחזקות מופיעות בפירוט החשבון.','quiet-empty'));
 else for(const p of positions){
  const protection=protectionView(p,status.pendingActions,now),card=el('article',null,'colmex-position');
  card.append(el('h3',p.symbol),el('span',protection.label,'protection-state '+protection.kind));
  const grid=el('div',null,'position-prices');
  for(const [label,value] of [['כמות',n(p.qty)],['כניסה','$'+price(p.entryPrice)],['מחיר שנצפה',freshAt(p.lastQuoteAt,now,120000)&&p.lastBid>0?'$'+price(p.lastBid):'—'],['סטופ מאושר',protection.stop>0?'$'+price(protection.stop):'—'],['יעד מאושר',protection.target>0?'$'+price(protection.target):'—'],['שיא שנצפה','$'+price(p.peakPrice)]]){const item=el('div');item.append(el('span',label),el('b',value));grid.append(item);}card.append(grid);
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
$('colmexOpenChart').onclick=()=>openPanel('colmexChartPanel');
$('colmexOpenAccount').onclick=()=>openPanel('colmexAccountDetails');
$('colmexOpenCalculator').onclick=()=>openPanel('colmexCalculator');
$('colmexOpenMonitoring').onclick=()=>openPanel('colmexMonitoringDetails');
$('colmexMapSelect').addEventListener('change',e=>{selectedPosition=e.target.value;renderMap(Date.now());});
$('colmexMapChart').onclick=()=>{if(selectedPosition)openPositionChart(selectedPosition);};
const marketPower=$('marketPowerSettingsPanel');if(marketPower)document.querySelector('#colmexChartPanel > .disclosure-content').append(marketPower);
const settings=$('openAppSettings');if(settings){$('colmexHeaderActions').append(settings);settings.textContent='⚙ הגדרות';}
function calculate(e){e?.preventDefault();scenarioCalculated=true;const form=$('colmexScenario'),input=Object.fromEntries(new FormData(form)),r=stockScenario(input),host=$('colmexScenarioResults'),visual=$('colmexScenarioVisual');host.replaceChildren();visual.replaceChildren();visual.hidden=!!r.error;$('colmexScenarioEmpty').hidden=!r.error;txt('colmexScenarioError',r.error||'');if(r.error)return;
 for(const [label,value,cls] of [['כמות מניות שלמות',n(r.quantity),''],['רווח ביעד אחרי העלויות שהוזנו','$'+signed(r.targetPnl),r.targetPnl>0?'positive':'negative'],['תוצאה בסטופ אחרי העלויות שהוזנו','$'+signed(r.stopPnl),'negative'],['מחיר איזון','$'+price(r.breakEven),''],['יחס רווח / סיכון',r.ratio===null?'אין רווח נטו ביעד':n(r.ratio)+' : 1',''],['עלות כולל עמלת קנייה','$'+n(r.debit),'']]){const item=el('article');item.append(el('span',label),el('strong',value,cls));host.append(item);}
 const bars=el('div',null,'scenario-bars'),max=Math.max(Math.abs(r.targetPnl),Math.abs(r.stopPnl));
 for(const [label,value] of [['תוצאה ביעד',r.targetPnl],['תוצאה בסטופ',r.stopPnl]]){const row=el('div',null,'scenario-bar-row'),track=el('div',null,'scenario-bar-track'),bar=el('i',null,value>0?'gain':'loss');bar.style.width=Math.abs(value)/max*100+'%';track.append(bar);track.setAttribute('aria-hidden','true');row.append(el('span',label),track,el('b','$'+signed(value),value>0?'positive':'negative'));bars.append(row);}visual.append(bars,el('p','יתרה שלא נוצלה בתקציב: $'+n(r.unused)+' · גובה העמודות משווה בין התוצאות לאחר העלויות שהזנת.','scenario-budget'));
}
$('colmexScenario').addEventListener('submit',calculate);
$('colmexScenario').addEventListener('input',()=>{if(scenarioCalculated)calculate();});
render();setInterval(()=>{if(!document.hidden)render();},15000);
