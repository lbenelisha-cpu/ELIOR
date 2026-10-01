import {prepareOrder,trackRisk,canPrepareOrder} from './monitor.mjs';
import {buyingPower} from './buying-power.mjs';
const el=id=>document.getElementById(id);
let latest=null,draft=null,tracking=null,lastKinds=new Map();
try{tracking=JSON.parse(localStorage.getItem('levi-tracking-639367')||'null');}catch{}
const text=(tag,value)=>{const e=document.createElement(tag);e.textContent=value;return e;};
function notify(id,message){window.LEVIAlerts?.notify({id,message,timestamp:Date.now()}).catch(()=>{});}
function persist(){try{localStorage.setItem('levi-tracking-639367',JSON.stringify(tracking));}catch{}}
function visibleQuotes(){return (latest?.quotes||[]).filter(q=>el('watch-symbol').value==='ALL'||/^nvda#?$/i.test(q.symbol));}
function showDraft(quote,side){draft={quote,side,ticket:0};el('draft-confirm').disabled=true;el('draft-symbol').textContent=quote.symbol+' · '+(side==='buy'?'קנייה':'מכירה')+' · טיוטה בלבד';el('draft-lots').value='';el('draft-result').textContent='הזן כמות בלוטים ובדוק את הפקודה. רק לאחר מכן תוכל לאשר שליחה ללייב.';el('order-draft').showModal();}
function render(){
 const root=el('signal-cards');root.replaceChildren();
 for(const q of visibleQuotes()){
  const card=document.createElement('section');
  const title=text('h3',''),symbol=text('span',q.symbol);symbol.dir='ltr';title.append(symbol,text('span',' · '+(q.kind==='positive'?'אות טכני חיובי':q.kind==='negative'?'אות טכני שלילי':'מעקב')));card.append(title);
  if(q.status==='current'&&q.confirmed&&q.kind==='positive'){
   symbol.className='buy-signal-symbol';card.classList.add('buy-signal-card');card.append(text('p','● אות קנייה טכני מאומת · נדרש אישור שלך לכל עסקה'));
  }
  const power=buyingPower(q,latest.account,latest.positions,latest.quotes);
  const cash=document.createElement('div');cash.className='buying-power';
  const money=n=>new Intl.NumberFormat('he-IL',{style:'currency',currency:'USD'}).format(n);
  if(!power.known)cash.append(text('p',power.message));
  else{
   cash.append(text('strong',`מינימום קנייה: ${power.minimumLots} לוטים · שווי מלא ${money(power.cost)}`));
   cash.append(text('p',power.cashEnough===null?'יתרת המזומן אינה זמינה':`יתרת חשבון: ${money(power.balance)} · ${power.cashEnough?'מספיקה לשווי המלא של כמות המינימום':'אינה מספיקה לשווי המלא של כמות המינימום'}`));
   cash.append(text('p',power.remaining===null?'חשיפת החזקות קיימות אינה ניתנת לאימות; קנייה חסומה':`מקום שנותר ביעד החשיפה: ${money(power.remaining)} · ${power.budgetEnough?'כמות המינימום בתוך יעד 120 דולר':'כמות המינימום חורגת מיעד 120 דולר — קנייה חסומה'}`));
   cash.append(text('p',power.freeMargin===null?'ביטחונות פנויים לא מדווחים בגרסת המחבר הזו. במניות CFD היתרה אינה בדיקת ביטחונות; MT4 בודק אותם שוב לפני ביצוע.':`ביטחונות פנויים: ${money(power.freeMargin)}. דרישת הביטחונות בפועל נבדקת ב־MT4 לפני ביצוע.`));
   cash.classList.add(power.budgetEnough&&power.cashEnough?'power-positive':'power-limited');
  }card.append(cash);
  card.append(text('p',q.status==='current'?`ציון ${q.score}/100 · ${q.confirmed?'3 אימותים בנרות סגורים':'טרם אומת ב־3 נרות'} · מגמה ${q.components.trend}, מומנטום ${q.components.momentum}, סיכון ${q.components.risk}`:q.reason));
  card.append(text('p',`מקור: ${q.source} · זמן מחיר: ${Number.isFinite(q.tickTime)?new Date(q.tickTime*1000).toLocaleString('he-IL'):'חסר'} · ביקוש ${q.bid??'—'} / היצע ${q.ask??'—'}`));
  card.append(text('p','האות מתאר את הנוסחה הטכנית בלבד; אינו מבטיח תוצאה או כולל עלויות, חדשות ודוחות.'));
  const actions=document.createElement('div');actions.className='trade-actions';
  for(const side of ['buy','sell']){const button=text('button',side==='buy'?'הכן קנייה':'הכן מכירה');button.type='button';button.className='trade-button trade-'+side;button.title='פתיחת טיוטה בלבד — לא נשלחת עסקה';button.disabled=!canPrepareOrder(q)||!latest.connected;button.onclick=()=>showDraft(q,side);actions.append(button);}card.append(actions);
  const key=q.confirmed?q.kind:'none';
  if(key!=='none'&&lastKinds.get(q.symbol)!==key)notify(q.symbol+':'+q.barTime+':'+key,q.symbol+' · '+(key==='positive'?'אות טכני חיובי חדש':'אות טכני שלילי חדש'));
  if(q.quoteRisk&&!lastKinds.get(q.symbol+'-risk'))notify(q.symbol+':risk:'+q.barTime,q.symbol+' · ציון סיכון נמוך בנוסחה');
  lastKinds.set(q.symbol,key);lastKinds.set(q.symbol+'-risk',!!q.quoteRisk);root.append(card);
 }
 if(!root.children.length)root.append(text('p','ממתין לנתוני מניות: הוסף NVDA לתצוגת השוק והתקן את גרסת המחבר המעודכנת.'));
 const select=el('tracked-ticket'),wanted=tracking?.ticket?String(tracking.ticket):'';select.replaceChildren(new Option('ללא שיוך',''));
 for(const p of latest?.positions||[])if(p.type===0)select.add(new Option(`${p.symbol} · עסקה ${p.ticket} · ${p.lots} לוטים`,String(p.ticket)));
 select.value=wanted;
 if(!tracking){el('portfolio-risk').textContent='טרם שויכה פוזיציה. אין חישוב ירידה של 15% לתיק ואין שיוך אוטומטי לעסקאות קיימות.';return;}
 const position=latest.positions?.find(p=>p.ticket===tracking.ticket);
 if(!position){el('portfolio-risk').textContent='הפוזיציה המשויכת אינה פתוחה. חסרים נתוני סגירה; חישוב סיכון התיק מושהה.';return;}
 tracking=trackRisk(tracking,position.profit);const equity=tracking.equity;persist();
 el('portfolio-risk').textContent=`שווי למעקב מאז השיוך: ${equity.toFixed(2)} דולר · שיא ${tracking.high.toFixed(2)} · סף 15% ${(tracking.high*.85).toFixed(2)} · ${tracking.halted?'סף הסיכון נחצה; אין סגירה אוטומטית':'בתוך הסף'}. השיוך אינו משנה את גודל העסקה או מבודד כספים בחשבון.`;
 if(tracking.halted)notify('portfolio-stop:'+tracking.ticket+':'+tracking.started,'סיכון: תיק המעקב ירד 15% מהשיא שנמדד מאז השיוך');
}
window.addEventListener('levi-snapshot',event=>{latest=event.detail;renderOrderStatus();if(latest.connected)render();else{el('signal-cards').replaceChildren(text('p','החשבון מנותק; האותות אינם זמינים'));el('portfolio-risk').textContent='חישוב הסיכון מושהה: החשבון מנותק';notify('disconnected','סיכון נתונים: MT4 מנותק');}});
window.addEventListener('levi-snapshot-error',()=>{latest=null;el('signal-cards').replaceChildren(text('p','הנתונים אינם זמינים; אין הכנת פקודות'));el('portfolio-risk').textContent='חישוב הסיכון מושהה עד לקבלת נתונים עדכניים';notify('feed-error','סיכון נתונים: לא התקבל עדכון תקין מ־MT4');});
el('watch-symbol').onchange=()=>{lastKinds.clear();if(latest)render();};
el('tracked-ticket').onchange=()=>{const p=latest?.positions?.find(p=>String(p.ticket)===el('tracked-ticket').value);tracking=p?{ticket:p.ticket,startProfit:p.profit,high:150,halted:false,started:Date.now()}:null;persist();if(latest)render();};
el('draft-close').onclick=()=>el('order-draft').close();
window.addEventListener('levi-order-draft',event=>{
 const {symbol,side,ticket}=event.detail||{};
 const position=latest?.positions?.find(p=>p.ticket===ticket&&p.symbol===symbol);
 const quote=latest?.quotes?.find(q=>q.symbol===symbol);
 if(!latest?.connected||!position||!canPrepareOrder(quote)||!['buy','sell'].includes(side))return;
 showDraft(quote,side);draft.ticket=ticket;
});
el('draft-check').onclick=async()=>{const checked=draft,lotsText=el('draft-lots').value;checked.approved=null;el('draft-confirm').disabled=true;try{if(!latest?.connected)throw Error('אין חיבור עדכני');if(draft.side==='buy'&&tracking?.halted)throw Error('סף סיכון התיק נחצה');const q=latest.quotes.find(q=>q.symbol===draft.quote.symbol),d=prepareOrder(q,draft.side,Number(el('draft-lots').value),latest.positions,Date.now()/1000,latest.quotes);el('draft-result').textContent=`${d.symbol} · ${d.side==='buy'?'קנייה':'מכירה'} · ${d.lots} לוטים · מחיר ייחוס ${d.price} · שווי משוער ${d.estimatedNotional.toFixed(2)} דולר. טיוטה נבדקה בלבד; לא נשלחה פקודה.`;if(latest.executionEnabled){const approved=await window.LEVIRequest('/api/order/preview',{symbol:q.symbol,side:draft.side,lots:d.lots,ticket:draft.ticket});if(draft!==checked||el('draft-lots').value!==lotsText||!el('order-draft').open)return;draft.approved=approved;el('draft-result').textContent=approved.order.symbol+' · '+(draft.side==='buy'?'קנייה חדשה':'סגירת קנייה קיימת')+' · '+d.lots+' לוטים · מחיר ייחוס '+approved.order.price+' · שווי משוער '+approved.order.estimatedNotional.toFixed(2)+' USD · חשבון לייב 639367'+(approved.order.ticket?' · עסקה '+approved.order.ticket:'')+' · אישור תקף ל־20 שניות. מחיר ביצוע עשוי להשתנות עד 0.5%; עמלות נוספות אפשריות.';el('draft-confirm').disabled=false;}else{el('draft-result').textContent+=' הביצוע כבוי במחבר MT4.';}}catch(e){el('draft-result').textContent=e.message;}};

// Fetch once after module listeners are registered, including a fast initial response.
el('refresh').click();


function renderOrderStatus(){
 const result=latest?.lastOrder;el('execution-status').textContent=latest?.orderPending?'פקודה ממתינה או דורשת בירור ב־MT4. אין לשלוח שוב.':result?'פקודה '+result.id+' · '+({completed:'הברוקר אישר ביצוע',rejected:'הפקודה נדחתה',unknown:'תוצאה לא ידועה — בדוק ב־MT4 ואל תשלח שוב'}[result.status]||result.status)+' · עסקה '+result.ticket+' · קוד '+result.error:latest?.executionEnabled?'ביצוע לאחר אישור אישי פעיל; אין פקודות שנשלחו מהאפליקציה.':'שליחה כבויה — יש להפעיל AllowUserApprovedOrders במחבר MT4.';
}
el('draft-lots').addEventListener('input',()=>{if(draft)draft.approved=null;el('draft-confirm').disabled=true;});
el('draft-confirm').onclick=async()=>{
 const approval=draft?.approved;el('draft-confirm').disabled=true;draft.approved=null;
 if(!latest?.connected||!latest.executionEnabled||latest.orderPending||(draft.side==='buy'&&tracking?.halted)||!approval||approval.expires<Date.now()){el('draft-result').textContent='האישור פג; בדוק את הפקודה מחדש';return;}
 try{const result=await window.LEVIRequest('/api/order/confirm',{id:approval.id,confirm:true});el('draft-result').textContent=result.message;el('execution-status').textContent=result.message;el('refresh').click();}
 catch(e){el('draft-result').textContent=e.message+' — אם השליחה נותקה, בדוק את הפוזיציות ולוג MT4 לפני ניסיון נוסף.';}
};


