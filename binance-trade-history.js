const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
const number=(n,d=4)=>n==null||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString('en-US',{maximumFractionDigits:d});
const signed=n=>n==null?'—':(n>0?'+':'')+number(n);
const time=value=>new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',dateStyle:'short',timeStyle:'short',hourCycle:'h23'}).format(new Date(value));
const reason=r=>({BROKER_STOP_LOSS:'סטופ הפסד בבורסה',BROKER_TAKE_PROFIT_50_PERCENT:'יעד רווח בבורסה',TRAILING_PROFIT_EXIT:'הגנת רווח נגררת',PROFIT_FLOOR4_TRAIL1PP_EXIT:'הגנת רווח נגררת',TRAIL_STOP_LOSS_1_PERCENT:'סטופ הפסד 1%',FIXED_STOP_LOSS_1_PERCENT:'סטופ הפסד 1%',FIXED_TAKE_PROFIT_4_PERCENT:'יעד רווח 4%',MANUAL_SELL:'מכירה ידנית',WYCKOFF_STOP_LOSS_0_5_PERCENT:'סטופ לפי הכלל שהיה בתוקף',EARLY_WAVE_BREAKOUT:'כניסה בגל עולה',WYCKOFF_SPRING_RSI_LIVE:'כניסה לפי Spring ו־RSI'})[r]||r||'לא תועדה סיבה באפליקציה';
export function createTradeHistoryPanel(host,{read}){
 let data=null,mode='live',request=0,busy=false,shown=20,lastAttempt=-Infinity;
 const heading=el('div',null,'history-heading'),intro=el('div');intro.append(el('span','BINANCE SPOT · ביצועים מהבורסה','history-eyebrow'),el('h2','היסטוריית קניות ומכירות'),el('p','ראה איך נכנסנו, איך יצאנו ומה נשאר אחרי העמלות.'));
 heading.append(intro);const form=el('form',null,'history-controls');
 const input=el('input');input.type='text';input.placeholder='ENA או ENAUSDT';input.autocomplete='off';input.setAttribute('aria-label','מטבע להיסטוריית העסקאות');input.setAttribute('list','historySymbols');input.dir='ltr';
 const choices=el('datalist');choices.id='historySymbols';
 const submit=el('button','טען מבייננס','refresh');submit.type='submit';
 const side=el('select');side.setAttribute('aria-label','סוג פעולה');for(const [value,label] of [['ALL','כל הפעולות'],['BUY','קניות'],['SELL','מכירות']]){const o=el('option',label);o.value=value;side.append(o);}
 const days=el('select');days.setAttribute('aria-label','תקופת ההיסטוריה');for(const [value,label] of [['0','כל ההיסטוריה שנטענה'],['7','7 ימים'],['30','30 ימים'],['90','90 ימים']]){const o=el('option',label);o.value=value;days.append(o);}
 form.append(input,choices,submit,side,days);
 const status=el('p','בחר מטבע כדי לקרוא את היסטוריית Binance.','history-status');status.setAttribute('role','status');
 const totals=el('div',null,'history-totals'),list=el('div',null,'history-orders'),more=el('button','הצג עוד 20 פעולות','refresh');more.type='button';more.hidden=true;
 const note=el('p','הרווח מחושב לפי עלות קנייה ממוצעת לביצועי Spot בצמד הנבחר, כולל עמלות במטבע הנכס וב־USDT. עמלה במטבע אחר אינה מומרת אוטומטית. הפקדות, משיכות והמרות מחוץ לצמד אינן כלולות.','history-method');
 host.append(heading,form,status,totals,list,more,note);
 function render(){
  totals.replaceChildren();list.replaceChildren();more.hidden=true;if(!data)return;
  const cutoff=Number(days.value)>0?Date.now()-Number(days.value)*86400000:0;
  const period=data.rows.filter(r=>Date.parse(r.at)>=cutoff),rows=period.filter(r=>side.value==='ALL'||r.side===side.value),sales=period.filter(r=>r.side==='SELL'),known=sales.filter(r=>r.netPnlUsdt!==null);
  const net=known.length?known.reduce((n,r)=>n+r.netPnlUsdt,0):null;
  for(const [label,value,kind]of [['קניות',period.filter(r=>r.side==='BUY').length,''],['מכירות',sales.length,''],['רווח / הפסד מחושב',signed(net)+' USDT',net>0?'gain':net<0?'loss':''],['מכירות עם נתונים חסרים',sales.length-known.length,'']]){const card=el('div');card.append(el('span',label),el('strong',String(value),kind));totals.append(card);}
  if(!rows.length){list.append(el('p','אין פעולות בטווח ובסינון שנבחרו.'));return;}
  for(const r of rows.slice(0,shown)){
   const card=el('details',null,'history-order'),summary=el('summary'),identity=el('div'),buy=r.side==='BUY',kind=r.netPnlUsdt==null?'unknown':r.netPnlUsdt>0?'gain':r.netPnlUsdt<0?'loss':'flat';
   identity.append(el('b',(buy?'קנייה':'מכירה')+' · '+r.symbol),el('small',time(r.at)+' · '+(buy?'רכישה':r.status==='UNKNOWN'?'ההחזקה הקודמת לא אומתה':r.status==='CLOSED'?'נסגרה לפי הביצועים':r.status==='DUST'?'יציאה עם שארית קטנה':'מכירה חלקית')));
   const result=el('div',null,'history-result '+kind);result.append(el('strong',buy?number(r.quoteQty)+' USDT':r.netPnlUsdt==null?'נתוני רווח חסרים':signed(r.netPnlUsdt)+' USDT'));
   result.append(el('small',buy?'סכום הקנייה לפני עמלה':r.netPnlPct==null?(r.unknownReason==='UNVALUED_FEE'?'עמלה במטבע נוסף':'חסרה קנייה תואמת'):signed(r.netPnlPct)+'% לאחר עמלות'));summary.append(identity,result);card.append(summary);
   const detail=el('div',null,'history-order-detail');
   const feeText=r.commissions.length?r.commissions.map(f=>number(f.amount,8)+' '+f.asset).join(' + '):'0';
   for(const [label,value]of [['מחיר ביצוע ממוצע',number(r.price,10)+' USDT'],['כמות שבוצעה',number(r.qty,8)],['עמלות הפעולה',feeText],...(!buy?[['עלות כניסה ממוצעת, כולל עמלות',number(r.entryPrice,10)+' USDT'],['מועד תחילת ההחזקה',r.entryAt?time(r.entryAt):'לא ידוע'],['סיבת היציאה',reason(r.reason)]]:[]),['מספר פקודה',r.orderId],['מספר ביצועים בפקודה',r.fillCount]]){const cell=el('div');cell.append(el('span',label),el('b',String(value)));detail.append(cell);}
   if(!buy&&r.unknownReason==='UNVALUED_FEE'&&r.pnlBeforeOtherFeesUsdt!=null)detail.append(el('p','תוצאה לפני העמלה שלא הומרה: '+signed(r.pnlBeforeOtherFeesUsdt)+' USDT. זו אינה תוצאת נטו.'));
   card.append(detail);list.append(card);
  }
  more.hidden=rows.length<=shown;
 }
 async function load(){
  if(mode!=='live'||busy)return;
  let symbol=input.value.trim().toUpperCase();if(!symbol.endsWith('USDT'))symbol+='USDT';
  if(!/^[A-Z0-9]{2,24}USDT$/.test(symbol)){status.textContent='יש להזין שם מטבע או צמד USDT תקין.';return;}
  input.value=symbol;const current=++request;lastAttempt=Date.now();busy=true;submit.disabled=true;input.disabled=true;data=null;render();status.textContent='קורא את הביצועים מ־Binance…';
  try{const result=await read(symbol);if(current!==request)return;if(!result?.ok)throw Error('לא התקבלה היסטוריה תקינה.');data=result;shown=20;status.textContent=(result.complete?'היסטוריית הביצועים שהוחזרה מבייננס':'היסטוריה חלקית · הגעת למגבלת הטעינה; ייתכנו פעולות חדשות יותר שלא נכללו')+' · '+symbol+' · עודכן '+time(result.asOf);render();}
  catch(e){if(current!==request)return;data=null;render();status.textContent=e.status===401?'נדרש חיבור מכשיר לצפייה בהיסטוריה.':e.message||'לא ניתן לטעון כעת את ההיסטוריה.';}
  finally{if(current===request){busy=false;submit.disabled=false;input.disabled=false;}}
 }
 form.addEventListener('submit',e=>{e.preventDefault();load();});side.addEventListener('change',()=>{shown=20;render();});days.addEventListener('change',()=>{shown=20;render();});more.addEventListener('click',()=>{shown+=20;render();});
 return {load,setContext(context){
  if(mode!==context.mode){mode=context.mode;request++;busy=false;submit.disabled=false;input.disabled=false;data=null;lastAttempt=-Infinity;render();}
  form.hidden=mode!=='live';note.hidden=mode!=='live';
  if(mode!=='live'){status.textContent=mode==='demo'?'היסטוריית Binance זמינה במצב LIVE. יומן הסימולציה מופיע בהמשך.':'נדרש חיבור מכשיר לצפייה בהיסטוריה.';return;}
  choices.replaceChildren(...(context.symbols||[]).map(s=>{const o=el('option');o.value=s;return o;}));
  if(!input.value)input.value=context.symbols?.[0]||context.selectedSymbol||'';
  if(context.visible&&!data&&!busy&&input.value&&Date.now()-lastAttempt>=60000)load();
 }};
}
const host=document.getElementById('binanceHistoryPanel');
if(host){
 const panel=createTradeHistoryPanel(host,{read:async symbol=>{
  const url=window.API_BASE+'/api/binance-trade-history?symbol='+encodeURIComponent(symbol);
  const response=await fetch(window.binanceReadUrl(url),{headers:window.binanceReadHeaders(url),cache:'no-store',signal:AbortSignal.timeout(30000)});
  const data=await response.json();if(!response.ok){const error=Error(data.error||'טעינת ההיסטוריה נכשלה.');error.status=response.status;throw error;}return data;
 }});
 window.addEventListener('levi:binance-history',e=>panel.setContext(e.detail));
 window.addEventListener('levi:binance-dashboard',e=>{if(e.detail?.unauthorized)panel.setContext({mode:'disconnected'});});
}
