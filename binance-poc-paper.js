const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
const num=x=>typeof x==='number'&&Number.isFinite(x);
const money=x=>num(x)?x.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
const signed=x=>num(x)?(x>0?'+':'')+money(x):'—';
const when=x=>num(x)?new Date(x).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}):'—';
const tone=x=>num(x)?x>0?'gain':x<0?'loss':'':'';
export function paperCsv(data){
 const rows=[['כיוון','נכס','מצב','כניסה · ישראל','יציאה · ישראל','מחיר כניסה','מחיר יציאה / נוכחי','כמות','רווח לאחר עמלות משוערות USDT','פער נתונים'],...data.accounts.flatMap(a=>[...(a.positions||[]).map(p=>[a.side,p.symbol,'פתוחה',when(p.entryAt),'',p.entry,p.mark,p.qty,p.net,p.gap?'כן':'לא']),...(a.closed||[]).map(p=>[a.side,p.symbol,'סגורה',when(p.entryAt),when(p.closedAt),p.entry,p.exit,p.qty,p.net,p.gap?'כן':'לא'])])];
 return '\uFEFF'+rows.map(r=>r.map(v=>{let s=v==null?'':String(v);if(typeof v==='string'&&/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}).join(',')).join('\r\n');
}
export function createPocPaperPanel(host,{read,now=Date.now,download=()=>{}}){
 let data=null,busy=false,generation=0,connected=false;
 const top=el('div',null,'paper-title-row'),title=el('div'),refresh=el('button','רענן מעקב'),exportBtn=el('button','ייצוא העסקאות המוצגות');refresh.type=exportBtn.type='button';
 title.append(el('span','דמו POC · ללא פקודות מסחר','paper-badge'),el('h2','הכסף האמיתי מול ביצועי הדמו'));top.append(title,refresh,exportBtn);
 const status=el('p','ממתין לחיבור המכשיר.','paper-status');status.setAttribute('role','status');
 const wrap=el('div',null,'paper-table-wrap'),table=el('table'),head=el('thead'),hr=el('tr'),body=el('tbody');
 for(const t of ['מסלול','שווי החשבון האמיתי כעת','מזומן אמיתי זמין','סכום פתיחת הדמו','שווי הדמו','רווח סגור · דמו','רווח פתוח · דמו','סה״כ רווח דמו','עסקאות דמו'])hr.append(el('th',t));head.append(hr);table.append(head,body);table.setAttribute('aria-label','השוואת יתרות אמיתיות וביצועי POC דמו');wrap.append(table);
 const policy=el('p',null,'paper-policy'),warning=el('p',null,'paper-warning');
 const details=el('details'),detailBody=el('div',null,'paper-table-wrap');details.append(el('summary','פוזיציות פתוחות ו־100 הסגירות האחרונות בכל מסלול'),detailBody);
 const dailyDetails=el('details'),dailyBody=el('div',null,'paper-table-wrap');dailyDetails.append(el('summary','מעקב יומי · מדידה אחרונה בכל יום UTC'),dailyBody);
 const scrollHint=el('p','החליקו את הטבלה הצידה לצפייה בכל העמודות.','paper-scroll-hint');
 host.append(top,status,scrollHint,wrap,policy,warning,details,dailyDetails);
 function render(){
  body.replaceChildren();detailBody.replaceChildren();dailyBody.replaceChildren();exportBtn.disabled=!data;
  policy.textContent='הדמו מתחיל פעם אחת משווי חשבון מאומת: Spot ל־LONG, הון Futures ב־USDT כולל רווח פתוח ל־SHORT. 5 מקומות ב־LONG ו־2 ב־SHORT, ללא מינוף. ההקצאה מתעדכנת מדי יום UTC לפי ההון ההתחלתי והרווח הסגור. הפקדות ומשיכות בהמשך אינן מאפסות את הדמו.';
  warning.textContent='';
  if(!data){const tr=el('tr'),td=el('td','אין נתונים מאומתים להצגה.');td.colSpan=9;tr.append(td);body.append(tr);return;}
  for(const a of data.accounts){
   const tr=el('tr');const cell=(value,note,cls)=>{const td=el('td');td.append(el('strong',value,cls));if(note)td.append(el('small',note));tr.append(td);};
   cell(a.side,a.side==='LONG'?'Spot':'USDⓈ-M Futures');cell(money(a.live?.equity),a.live?'עודכן '+when(a.live.at):'ממתין ליתרה מאומתת');cell(money(a.live?.free),'USDT');
   cell(money(a.seed),a.startedAt?when(a.startedAt):a.status==='ZERO_BALANCE'?'יתרה אפס · הדמו טרם התחיל':'טרם נקבע סכום פתיחה');
   cell(money(a.equity),'USDT');cell(signed(a.realized),'לאחר עמלות משוערות',tone(a.realized));cell(signed(a.openPnl),'לפני עמלת יציאה ומימון',tone(a.openPnl));cell(signed(a.totalPnl),num(a.pct)?signed(a.pct)+'%':'—',tone(a.totalPnl));
   cell(a.startedAt?`${a.closedCount} סגורות`:'—',a.positions?`${a.positions.length} פתוחות · ${a.pending.length} ממתינות`:'ממתין לנתונים');body.append(tr);
  }
  const rows=data.accounts.flatMap(a=>[...(a.positions||[]).map(p=>({...p,status:'פתוחה',displayAt:p.entryAt})),...(a.closed||[]).map(p=>({...p,status:'סגורה',displayAt:p.closedAt}))]).sort((a,b)=>b.displayAt-a.displayAt);
  const trades=el('table'),th=el('tr');for(const t of ['נכס / כיוון','מצב','כניסה · ישראל','יציאה · ישראל','מחיר כניסה','מחיר נוכחי / יציאה','רווח דמו · USDT','איכות הנתונים'])th.append(el('th',t));trades.append(th);
  for(const p of rows){const tr=el('tr');for(const t of [p.symbol+' · '+p.side,p.status,when(p.entryAt),when(p.closedAt),String(p.entry),String(p.exit??p.mark),signed(p.net),p.gap?'פער מעקב · תוצאה מותנית':'מחירים שנצפו'])tr.append(el('td',t));trades.append(tr);}if(!rows.length){const tr=el('tr'),td=el('td','עדיין אין עסקאות דמו. ממתינים לתבנית ולחצייה חדשה של POC.');td.colSpan=8;tr.append(td);trades.append(tr);}detailBody.append(trades);
  const daily=el('table'),dh=el('tr');for(const t of ['תאריך UTC','מסלול','שווי דמו','רווח סגור מצטבר','רווח פתוח','עסקאות עם פער מעקב'])dh.append(el('th',t));daily.append(dh);
  for(const a of data.accounts)for(const d of [...(a.daily||[])].reverse()){const tr=el('tr');for(const v of [d.day,a.side,money(d.equity),signed(d.realized),signed(d.open),d.gaps])tr.append(el('td',v));daily.append(tr);}dailyBody.append(daily);
  const p=data.policy;
  policy.textContent+=` כניסה בחצייה חוזרת של POC בכיוון המגמה; מבנה 50 נרות סגורים של 5 דקות. יציאה בנסיגה של ${p.trailingPct}% מהשיא / השפל מאז הכניסה, או בסטופ המבני — המוקדם מביניהם. בדיקת ציטוטים כל 5 שניות, ללא המתנה לסגירת נר. עמלה משוערת ${p.roundTripFeePct}% לסיבוב, והמרווח בין קנייה למכירה כלול.`;
  const gaps=data.accounts.reduce((s,a)=>s+(a.gapTrades||0),0);
  warning.textContent='POC מחושב בקירוב מנפח נרות דקה. התוצאות אינן ביצועים בבורסה; מימון SHORT והחלקת ביצוע נוספת אינם כלולים. היתרה האמיתית אינה רווח השיטה, משום שהיא מושפעת גם מהפקדות ומשיכות.'+(gaps?` ${gaps} עסקאות חוו הפסקת מעקב; תוצאותיהן מותנות ומסומנות.`:'')+(data.issues?.length?` יש ${data.issues.length} מקורות עם נתונים חסרים; לא נפתחות עסקאות דמו על נתון חסר.`:'');
 }
 async function load(){
  if(!connected||busy)return;busy=true;const request=++generation;refresh.disabled=true;
  try{const d=await read();if(request!==generation)return;if(!d?.ok||d.version!=='POC_PAPER_V1'||d.executionEnabled!==false||!Array.isArray(d.accounts))throw Error('PAPER_UNAVAILABLE');data=d;render();status.textContent='מעקב דמו בשרת · בדיקת מחירים אחרונה: '+when(d.lastCycle)+' · כל הסכומים ב־USDT';if(!d.lastCycle||now()-d.lastCycle>15000)status.textContent+=' · המעקב אינו עדכני כרגע';}
  catch(e){if(request!==generation)return;data=null;render();status.textContent=e.status===404?'הטבלה מוכנה; מנגנון הדמו עדיין לא הותקן בשרת.':e.status===401?'נדרש חיבור מכשיר לצפייה ביתרות ובדמו.':'לא ניתן לאמת את נתוני הדמו כרגע; התוצאות הקודמות אינן מוצגות כעדכניות.';}
  finally{if(request===generation){busy=false;refresh.disabled=false;}}
 }
 function setConnected(value){if(value===connected)return;connected=value;generation++;busy=false;data=null;render();refresh.disabled=!value;status.textContent=value?'טוען את המעקב…':'נדרש חיבור מכשיר לצפייה ביתרות ובדמו.';if(value)void load();}
 refresh.addEventListener('click',load);exportBtn.addEventListener('click',()=>{if(data)download(paperCsv(data),'LEVI-POC-demo.csv');});render();return {load,setConnected};
}
const host=document.getElementById('pocPaperPanel');
if(host){
 const panel=createPocPaperPanel(host,{read:async()=>{const url=window.API_BASE+'/api/binance-poc-paper',r=await fetch(window.binanceReadUrl(url),{headers:window.binanceReadHeaders(url),cache:'no-store',signal:AbortSignal.timeout(12000)});if(!r.ok){const e=Error('READ_FAILED');e.status=r.status;throw e;}return r.json();},download:(content,name)=>{const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'})),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}});
 const connect=()=>panel.setConnected(Boolean(window.LEVI_TRADE_AUTH?.read()));
 window.addEventListener('levi:binance-dashboard',connect);window.addEventListener('trade-device-expired',()=>panel.setConnected(false));
 setInterval(()=>{connect();if(!document.hidden&&!host.hidden)void panel.load();},15000);connect();
}
