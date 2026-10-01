import {prepareOrder,trackRisk} from './monitor.mjs';
const el=id=>document.getElementById(id);
let latest=null,draft=null,tracking=null,lastKinds=new Map();
try{tracking=JSON.parse(localStorage.getItem('levi-tracking-639367')||'null');}catch{}
const text=(tag,value)=>{const e=document.createElement(tag);e.textContent=value;return e;};
function notify(id,message){window.LEVIAlerts?.notify({id,message,timestamp:Date.now()}).catch(()=>{});}
function persist(){try{localStorage.setItem('levi-tracking-639367',JSON.stringify(tracking));}catch{}}
function visibleQuotes(){return (latest?.quotes||[]).filter(q=>el('watch-symbol').value==='ALL'||/^nvda#?$/i.test(q.symbol));}
function showDraft(quote,side){draft={quote,side};el('draft-symbol').textContent=quote.symbol+' · '+(side==='buy'?'קנייה':'מכירה')+' · טיוטה בלבד';el('draft-lots').value='';el('draft-result').textContent='הזן כמות בלוטים לפי מפרט הברוקר. אין שליחת פקודות בעדכון זה.';el('order-draft').showModal();}
function render(){
 const root=el('signal-cards');root.replaceChildren();
 for(const q of visibleQuotes()){
  const card=document.createElement('section');
  card.append(text('h3',q.symbol+' · '+(q.kind==='positive'?'אות טכני חיובי':q.kind==='negative'?'אות טכני שלילי':'מעקב')));
  card.append(text('p',q.status==='current'?`ציון ${q.score}/100 · ${q.confirmed?'3 אימותים בנרות סגורים':'טרם אומת ב־3 נרות'} · מגמה ${q.components.trend}, מומנטום ${q.components.momentum}, סיכון ${q.components.risk}`:q.reason));
  card.append(text('p',`מקור: ${q.source} · זמן מחיר: ${Number.isFinite(q.tickTime)?new Date(q.tickTime*1000).toLocaleString('he-IL'):'חסר'} · ביקוש ${q.bid??'—'} / היצע ${q.ask??'—'}`));
  card.append(text('p','האות מתאר את הנוסחה הטכנית בלבד; אינו מבטיח תוצאה או כולל עלויות, חדשות ודוחות.'));
  for(const side of ['buy','sell']){const button=text('button',side==='buy'?'הכן קנייה':'הכן מכירה');button.disabled=q.status!=='current'||!latest.connected;button.onclick=()=>showDraft(q,side);card.append(button);}
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
window.addEventListener('levi-snapshot',event=>{latest=event.detail;if(latest.connected)render();else{el('signal-cards').replaceChildren(text('p','החשבון מנותק; האותות אינם זמינים'));el('portfolio-risk').textContent='חישוב הסיכון מושהה: החשבון מנותק';notify('disconnected','סיכון נתונים: MT4 מנותק');}});
window.addEventListener('levi-snapshot-error',()=>{latest=null;el('signal-cards').replaceChildren(text('p','הנתונים אינם זמינים; אין הכנת פקודות'));el('portfolio-risk').textContent='חישוב הסיכון מושהה עד לקבלת נתונים עדכניים';notify('feed-error','סיכון נתונים: לא התקבל עדכון תקין מ־MT4');});
el('watch-symbol').onchange=()=>{lastKinds.clear();if(latest)render();};
el('tracked-ticket').onchange=()=>{const p=latest?.positions?.find(p=>String(p.ticket)===el('tracked-ticket').value);tracking=p?{ticket:p.ticket,startProfit:p.profit,high:150,halted:false,started:Date.now()}:null;persist();if(latest)render();};
el('draft-close').onclick=()=>el('order-draft').close();
el('draft-check').onclick=()=>{try{if(!latest?.connected)throw Error('אין חיבור עדכני');if(draft.side==='buy'&&tracking?.halted)throw Error('סף סיכון התיק נחצה');const q=latest.quotes.find(q=>q.symbol===draft.quote.symbol),d=prepareOrder(q,draft.side,Number(el('draft-lots').value),latest.positions,Date.now()/1000,latest.quotes);el('draft-result').textContent=`${d.symbol} · ${d.side==='buy'?'קנייה':'מכירה'} · ${d.lots} לוטים · מחיר ייחוס ${d.price} · שווי משוער ${d.estimatedNotional.toFixed(2)} דולר. טיוטה נבדקה בלבד; לא נשלחה פקודה.`;}catch(e){el('draft-result').textContent=e.message;}};

// Fetch once after module listeners are registered, including a fast initial response.
el('refresh').click();

