import {finite,tradeScenario,allocationParts,accountSummary,protectionState} from './lib/binance-dashboard-math.mjs';

const $=id=>document.getElementById(id);
const number=(v,d=2)=>finite(v)===null?'—':Number(v).toLocaleString('en-US',{maximumFractionDigits:d});
const price=v=>finite(v)>0?Number(v).toLocaleString('en-US',{maximumSignificantDigits:8}):'—';
const signed=(v,d=2)=>finite(v)===null?'—':(v>0?'+':'')+number(v,d);
const text=(id,value)=>{const e=$(id);if(e)e.textContent=value;};
const node=(tag,content,cls)=>{const e=document.createElement(tag);if(content!=null)e.textContent=content;if(cls)e.className=cls;return e;};
let snapshot=window.LEVI_DASHBOARD_SNAPSHOT||null, selected=null;
const menu=document.querySelector('.dashboard-menu'),settings=$('openAppSettings');
if(menu&&settings){const utilities=node('div',null,'header-utilities');menu.replaceWith(utilities);utilities.append(settings,menu);settings.textContent='⚙ הגדרות';}


function renderHealth(){
  const connected=window.LEVI_MANUAL_TRADES?.connected?.()===true;
  $('overviewConnect').hidden=connected;
  const age=snapshot?.receivedAt?Date.now()-snapshot.receivedAt:Infinity;
  let state={kind:'unknown',text:connected?'ממתין לנתוני החשבון':'חבר את המכשיר כדי לצפות בנתוני החשבון'};
  if(snapshot?.error)state={kind:'warning',text:snapshot.unauthorized?'נדרש חיבור מכשיר לצפייה בחשבון':'העדכון לא התקבל · נתוני החשבון אינם מאומתים כעת'};
  else if(snapshot?.agent&&age<=60000){
    state=snapshot.mode==='live'?protectionState(snapshot.agent.config?.liveState):{kind:'neutral',text:'סביבת DEMO · הנתונים אינם חשבון LIVE'};
    if(snapshot.mode==='live'&&!snapshot.account)state={kind:'warning',text:'ממתין לאימות יתרות החשבון'};
    else if(snapshot.agent.tradeControl?.paused)state.text+=' · קניות חדשות מושהות';
  }else if(snapshot?.receivedAt)state={kind:'warning',text:'הנתונים לא אומתו בדקה האחרונה · ממתין לרענון'};
  $('overviewHealth').dataset.state=state.kind;
  text('overviewHealthText',state.text);
  text('overviewMode',snapshot?.mode==='live'?'LIVE · חשבון אמיתי':snapshot?.mode==='demo'?'DEMO · סימולציה':'ממתין לחיבור');
  $('overviewMode').dataset.mode=snapshot?.mode||'unknown';
  text('overviewUpdated',snapshot?.receivedAt?'עדכון התקבל ב־'+new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(snapshot.receivedAt)+(age>60000?' · לא עדכני':''):'טרם התקבלו נתונים');
  return age<=60000&&!snapshot?.error;
}

function renderPosition(summary,fresh){
  const list=summary?.positions||[],select=$('positionMapSelect');
  const optionsKey=list.map(p=>p.symbol).join('|');
  if(select.dataset.options!==optionsKey){select.replaceChildren(...list.map(p=>{const o=node('option',p.symbol);o.value=p.symbol;return o;}));select.dataset.options=optionsKey;}
  if(!list.some(p=>p.symbol===selected))selected=list[0]?.symbol||null;
  select.value=selected||'';select.hidden=list.length<2;
  const host=$('positionMapContent');host.replaceChildren();
  $('positionMapChart').hidden=!selected||!fresh;
  text('positionMapTitle',selected||(!summary?'ממתין לפוזיציות':'אין פוזיציה פעילה'));
  if(!selected||!fresh){host.append(node('p',!fresh?'נתוני הפוזיציה יוצגו לאחר אימות עדכני של החשבון.':'מפת המחירים תופיע כשיש פוזיציה פעילה.','quiet-empty'));return;}
  const p=list.find(p=>p.symbol===selected),s=snapshot.agent.agents?.find(a=>a.symbol===selected)?.strategy;
  const entry=finite(p.entryPrice),current=finite(p.usdtPrice??p.currentPrice);
  const managed=s&&['FIXED_TP4_SL1_V1','PROFIT_FLOOR4_TRAIL1PP_STOP1_V1'].includes(s.exitPolicy);
  const protection=s?.brokerProtection;
  const verified=snapshot.mode==='live'&&managed&&snapshot.agent.config?.liveState?.ready===true&&protection?.status==='ACTIVE'&&finite(protection.verifiedAt)>Date.now()-60000;
  const stop=managed?finite(verified?protection.stopPrice:s.effectiveStopPrice):null;
  const target=managed?finite(verified?protection.takeProfitPrice:s.entryPrice*(1+(s.takeProfitPct??50)/100)):null;
  const grid=node('div',null,'position-prices');
  for(const [label,value,cls]of [['כניסה',entry,''],['מחיר נוכחי',current,''],['סטופ',stop,'negative'],['יעד רווח',target,'positive']]){
    const item=node('div');item.append(node('span',label),node('b',price(value),cls));grid.append(item);
  }host.append(grid);
  if(entry>0&&current>0&&stop>0&&target>stop){
    const lo=Math.min(stop,current,entry),hi=Math.max(target,current,entry),pct=v=>(v-lo)/(hi-lo)*100;
    const rail=node('div',null,'price-rail');rail.setAttribute('role','img');
    rail.setAttribute('aria-label','מפת מחירים: סטופ '+price(stop)+', כניסה '+price(entry)+', נוכחי '+price(current)+', יעד '+price(target));
    for(const [v,cls]of [[stop,'stop'],[entry,'entry'],[target,'target'],[current,'current']]){const marker=node('i',null,cls);marker.style.left=pct(v)+'%';rail.append(marker);}host.append(rail);
    host.append(node('p','מרחק מהמחיר הנוכחי: סטופ '+number((stop/current-1)*100)+'% · יעד '+signed((target/current-1)*100)+'%','map-distances'));
  }
  host.append(node('p',verified?'● מחירי ההגנה אומתו בבורסה':snapshot.mode==='demo'?'סימולציה · רמות מתוכננות, ללא הגנה בחשבון LIVE':managed?'הגנות הבורסה טרם אומתו · הרמות מוצגות לפי הגדרות הפוזיציה':'לא אומתה פוזיציה מנוהלת · אין רמות הגנה להצגה',verified?'map-note positive':'map-note'));
  host.append(node('small','המחירים לפני עמלות; מחיר הביצוע עשוי להיות שונה.'));
}

function render(){
  const fresh=renderHealth();
  const summary=fresh&&snapshot?.agent?accountSummary(snapshot):null;
  const currency=summary?.currency||'';
  text('overviewCurrency',currency);text('overviewValue',number(summary?.total));text('overviewCash',number(summary?.cash));
  text('overviewValueNote',summary?.partial?'שווי חלקי · חסרים מחירים':'לפי נתוני החשבון');
  text('overviewPnlLabel',snapshot?.mode==='demo'?'רווח / הפסד בסימולציה':'רווח / הפסד לא ממומש');
  text('overviewPnl',signed(summary?.pnl));
  $('overviewPnl').dataset.sign=summary?.pnl>0?'positive':summary?.pnl<0?'negative':'unknown';
  text('overviewPnlNote',!summary?'ממתין לנתוני החשבון':summary.pnl===null?'חסרה עלות קנייה מאומתת':snapshot.mode==='live'?'לפני עמלת מכירה · ללא שאריות קטנות':'לפי תיק הסימולציה');
  text('overviewSlots',summary?summary.count+' / '+summary.max:'—');
  $('overviewSlotDots').replaceChildren(...Array.from({length:Math.min(12,summary?.max||5)},(_,i)=>node('i',null,summary&&i<summary.count?'used':'')));
  const allocation=summary&&!summary.partial?allocationParts(summary.total,summary.cash):null;
  $('allocationRing').style.setProperty('--cash-angle',allocation?allocation.cashPct*3.6+'deg':'0deg');
  $('allocationRing').classList.toggle('unavailable',!allocation);
  $('allocationRing').setAttribute('aria-label',allocation?'מזומן זמין '+number(allocation.cashPct)+' אחוז; יתרת התיק בנכסים ויתרות נעולות':'חלוקת תיק אינה זמינה');
  text('allocationPercent',allocation?number(allocation.cashPct,0)+'%':'—');
  text('allocationCash',allocation?number(allocation.cash)+' '+currency:'—');text('allocationOther',allocation?number(allocation.other)+' '+currency:'—');
  text('allocationNote',summary?.partial?'החלוקה אינה מוצגת כשחסרים מחירים':allocation?'כולל יתרות קטנות ונעולות':'יוצג לאחר אימות נתוני החשבון');
  renderPosition(summary,fresh);
}

$('overviewConnect').addEventListener('click',()=>window.LEVI_DEVICE_ACCESS?.open());
$('positionMapSelect').addEventListener('change',e=>{selected=e.target.value;render();});
$('positionMapChart').addEventListener('click',()=>window.dispatchEvent(new CustomEvent('levi-dashboard-select',{detail:selected})));
$('collapseDashboard').addEventListener('click',()=>{
  document.querySelectorAll('main details[open]').forEach(d=>d.open=false);
  document.querySelectorAll('[data-detail-toggle][aria-expanded="true"]').forEach(b=>b.click());
});
window.addEventListener('levi:binance-dashboard',event=>{snapshot=event.detail;render();});
window.addEventListener('focus',render);
setInterval(()=>{if(!document.hidden)render();},10000);

const form=$('scenarioForm');
function calculate(event){
  event?.preventDefault();
  const r=tradeScenario({amount:$('scenarioAmount').value,entry:$('scenarioEntry').value,target:$('scenarioTarget').value,stop:$('scenarioStop').value,feePct:$('scenarioFee').value});
  text('scenarioError',r.error||'');const host=$('scenarioResults');host.replaceChildren();host.hidden=!!r.error;
  if(r.error)return;
  const grid=node('div',null,'scenario-result-grid');
  for(const [label,value,cls]of [['במחיר היעד',signed(r.targetPnl,4)+' USDT',r.targetPnl>0?'positive':'negative'],['במחיר הסטופ',signed(r.stopPnl,4)+' USDT','negative'],['יחס רווח לסיכון',r.ratio===null?'אין רווח נטו ביעד':number(r.ratio)+' : 1',''],['מחיר איזון אחרי עמלות',price(r.breakEven),'']]){
    const card=node('div',null,'scenario-result');card.append(node('span',label),node('strong',value,cls));grid.append(card);
  }host.append(grid);
  const bars=node('div',null,'scenario-bars');
  const max=Math.max(Math.abs(r.targetPnl),Math.abs(r.stopPnl));
  for(const [label,value]of [['תוצאה ביעד',r.targetPnl],['תוצאה בסטופ',r.stopPnl]]){const row=node('div');row.append(node('span',label));const track=node('div',null,'scenario-bar-track'),bar=node('i',null,value>0?'gain':'loss');bar.style.width=Math.abs(value)/max*100+'%';track.append(bar);row.append(track,node('b',signed(value,4)));bars.append(row);}host.append(bars);
  host.append(node('p','כמות משוערת: '+price(r.quantity)+' · חיוב כולל עמלת קנייה: '+number(r.debit)+' USDT · סך עמלות בתרחיש היעד: '+number(r.targetFees,4)+' USDT','mini'));
}
form.addEventListener('submit',calculate);
form.addEventListener('input',()=>{if(!$('scenarioResults').hidden)calculate();});
render();
