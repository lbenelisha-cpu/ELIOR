const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
const numeric=n=>typeof n==='number'&&Number.isFinite(n);
const format=(n,d=4)=>numeric(n)?n.toLocaleString('en-US',{maximumFractionDigits:d}):'—';
const signed=n=>numeric(n)?(n>0?'+':'')+format(n):'—';
const tone=n=>!numeric(n)?'unknown':n>0?'gain':n<0?'loss':'flat';
const dateKey=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
const when=t=>numeric(t)?new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',dateStyle:'short',timeStyle:'short',hourCycle:'h23'}).format(new Date(t)):'—';
const issueLabel=code=>({MISSING_ENTRY_COST:'חסרה עלות כניסה תואמת',COST_OR_FEES_UNVERIFIED:'עלות או עמלות לא אומתו',UNVALUED_FEE:'עמלה במטבע נוסף לא הומרה',AWAITING_EXCHANGE_HISTORY:'ממתין לבדיקת ביצועים בבייננס',EXCHANGE_HISTORY_EXPIRED:'הביצועים מחוץ לטווח ההיסטוריה הזמין',HISTORY_LIMIT_REACHED:'היסטוריית הביצועים חלקית',PNL_CACHE_UNAVAILABLE:'שמירת תוצאות הדוח אינה זמינה',SPOT_JOURNAL_UNAVAILABLE:'יומן LONG אינו זמין',SHORT_JOURNAL_UNAVAILABLE:'יומן SHORT אינו זמין'})[code]||'לא ניתן לאמת את כל נתוני העסקה';
const reasonLabel=reason=>({CHANNEL_TAKE_PROFIT:'יעד תעלת קיצון',CHANNEL_STOP_LOSS:'סטופ הפסד',TRAILING_PROFIT_EXIT:'הגנת רווח נגררת',BROKER_STOP_LOSS:'סטופ בבורסה',BROKER_OR_EXTERNAL_CLOSE:'סגירה בבורסה / מחוץ לבוט',MANUAL_SELL:'מכירה ידנית',MANUAL_STOP_ALL:'עצירה ידנית',FUTURES_PROTECTION_FAILED:'כשל בהגנת הפוזיציה'})[reason]||reason||'לא תועדה';
const feesText=fees=>Array.isArray(fees)&&fees.length?Object.entries(fees.reduce((m,f)=>{m[f.asset]=(m[f.asset]||0)+f.amount;return m;},{})).map(([asset,amount])=>format(amount,8)+' '+asset).join(' + '):'—';

export function filterPnlRows(rows,{direction='ALL',symbol='',period='30',from='',to='',sort='newest'}={},now=Date.now()){
 const today=dateKey(now),start=period==='today'?today:period==='7'||period==='30'||period==='90'?dateKey(now-(Number(period)-1)*86400000):period==='custom'?from:'';
 const end=period==='custom'?to:today,search=symbol.trim().toUpperCase();
 return rows.filter(r=>numeric(r.closedAt)&&r.closedAt<=now&&(direction==='ALL'||r.direction===direction)&&r.symbol.includes(search)&&(!start||dateKey(r.closedAt)>=start)&&(!end||dateKey(r.closedAt)<=end)).slice().sort((a,b)=>{
  if(sort==='profit'){if(!numeric(a.netPnlUsdt))return numeric(b.netPnlUsdt)?1:0;if(!numeric(b.netPnlUsdt))return -1;return b.netPnlUsdt-a.netPnlUsdt;}
  return b.closedAt-a.closedAt;
 });
}
export function summarizePnl(rows){
 const known=rows.filter(r=>numeric(r.netPnlUsdt)),wins=known.filter(r=>r.netPnlUsdt>0).length,losses=known.filter(r=>r.netPnlUsdt<0).length;
 return {count:rows.length,known:known.length,unknown:rows.length-known.length,net:known.length?known.reduce((n,r)=>n+r.netPnlUsdt,0):null,wins,losses,flat:known.length-wins-losses,winRate:known.length?wins/known.length*100:null};
}
export function pnlCsv(rows){
 const cell=v=>{const text=v==null?'':String(v),safe=typeof v==='string'&&/^[=+\-@\t\r]/.test(text)?"'"+text:text;return '"'+safe.replaceAll('"','""')+'"';};
 const header=['נכס','כיוון','שוק','מועד כניסה · ישראל','מועד יציאה · ישראל','כמות','מחיר כניסה','מחיר יציאה','עלות מיוחסת USDT','עמלות כניסה ויציאה','מימון USDT','רווח נטו USDT','תשואה על עלות %','מצב','סיבת יציאה','אימות'];
 return '\uFEFF'+[header,...rows.map(r=>[r.symbol,r.direction,r.market,when(r.entryAt),when(r.closedAt),r.qty,r.entryPrice,r.exitPrice,r.costUsdt,feesText(r.fees),r.fundingUsdt,r.netPnlUsdt,r.netPnlPct,r.status==='PARTIAL'?'יציאה חלקית':'סגירה',reasonLabel(r.reason),r.issue?issueLabel(r.issue):'מחושב'])].map(row=>row.map(cell).join(',')).join('\r\n');
}

export function createTradingPnlPanel(host,{read,download=()=>{},now=Date.now,onData=()=>{}}){
 let context={mode:'disconnected',visible:false},data=null,busy=false,request=0,lastAttempt=-Infinity,shown=25;
 const heading=el('div',null,'pnl-heading'),intro=el('div');intro.append(el('span','BINANCE · LONG + SHORT','pnl-eyebrow'),el('h2','רווח והפסד מהמסחר'),el('p','כל יציאה במקום אחד · תוצאות שמומשו, לאחר עמלות ומימון'));
 const refresh=el('button','רענן נתונים','refresh'),exportBtn=el('button','ייצוא CSV לאקסל','refresh');refresh.type=exportBtn.type='button';heading.append(intro,refresh,exportBtn);
 const controls=el('div',null,'pnl-controls');
 function select(label,choices){const wrap=el('label',label),input=el('select');input.setAttribute('aria-label',label);for(const [value,text] of choices){const option=el('option',text);option.value=value;input.append(option);}wrap.append(input);controls.append(wrap);return input;}
 const period=select('תקופה',[['30','30 ימים'],['today','היום'],['7','7 ימים'],['90','90 ימים'],['all','כל ההיסטוריה השמורה'],['custom','טווח תאריכים']]);
 const direction=select('כיוון',[['ALL','LONG ו־SHORT'],['LONG','LONG · Spot'],['SHORT','SHORT · Futures']]);
 const symbolWrap=el('label','חיפוש נכס'),symbol=el('input');symbol.placeholder='למשל ETH או IDOL';symbol.dir='ltr';symbol.setAttribute('aria-label','חיפוש נכס ברווח והפסד');symbolWrap.append(symbol);controls.append(symbolWrap);
 const sort=select('מיון',[['newest','מהחדש לישן'],['profit','לפי רווח נטו']]);
 const fromWrap=el('label','מתאריך'),toWrap=el('label','עד תאריך'),from=el('input'),to=el('input');from.type=to.type='date';from.setAttribute('aria-label','מתאריך');to.setAttribute('aria-label','עד תאריך');fromWrap.append(from);toWrap.append(to);controls.append(fromWrap,toWrap);fromWrap.hidden=toWrap.hidden=true;
 const status=el('p','מחכה לחיבור לחשבון LIVE.','pnl-status');status.setAttribute('role','status');
 const totals=el('div',null,'pnl-totals'),counts=el('p',null,'pnl-counts'),wrap=el('div',null,'pnl-table-wrap'),table=el('table',null,'pnl-table');table.setAttribute('aria-label','רווח והפסד LONG ו־SHORT');
 const thead=el('thead'),tr=el('tr');for(const text of ['נכס / כיוון','כניסה ← יציאה','מחירי ביצוע','כמות / עלות','עמלות','מימון · USDT','רווח נטו · USDT','תשואה על עלות','סיבת יציאה / אימות']){const th=el('th',text);th.scope='col';tr.append(th);}thead.append(tr);const tbody=el('tbody');table.append(thead,tbody);wrap.append(table);
 const more=el('button','הצג עוד 25 יציאות','refresh');more.type='button';more.hidden=true;
 const note=el('p','הסיכום כולל יציאות מלאות וחלקיות בלבד. הסינון לפי מועד היציאה בשעון ישראל. LONG מחושב לפי עלות ממוצעת ביומן הביצועים השמור; SHORT נבדק מול ביצועי Binance ותשלומי המימון, עד 100 הסגירות השמורות ביומן. תשואה מחושבת על העלות המיוחסת ליציאה, ולא על כל התיק. עמלות במטבע הנכס כבר נכללות בכמות LONG; עמלה במטבע אחר או נתון חסר אינם נספרים כאפס. העברות, הפקדות ורווח פתוח אינם כלולים.','pnl-note');
 host.append(heading,controls,status,totals,counts,wrap,more,note);
 function filtered(){return data?filterPnlRows(data.rows,{period:period.value,direction:direction.value,symbol:symbol.value,from:from.value,to:to.value,sort:sort.value},now()):[];}
 function render(){
  totals.replaceChildren();tbody.replaceChildren();counts.textContent='';more.hidden=true;exportBtn.disabled=!data;controls.hidden=context.mode!=='live';fromWrap.hidden=toWrap.hidden=period.value!=='custom';
  if(!data)return;
  if(period.value==='custom'&&from.value&&to.value&&from.value>to.value){status.textContent='תאריך ההתחלה חייב להיות לפני תאריך הסיום.';exportBtn.disabled=true;return;}
  const rows=filtered(),all=summarizePnl(rows),healthIssue=data.issues?.length>0;
  status.textContent='עודכן '+when(data.asOf)+(data.loadingShort?' · מאמת סגירות SHORT מול Binance…':'')+(healthIssue?' · '+data.issues.map(issueLabel).join(' · '):'');
  for(const [title,items] of [['סה״כ רווח / הפסד נטו',rows],['LONG · Spot',rows.filter(r=>r.direction==='LONG')],['SHORT · Futures',rows.filter(r=>r.direction==='SHORT')]]){
   const summary=summarizePnl(items),card=el('div',null,'pnl-total'),value=el('strong',signed(summary.net)+' USDT',tone(summary.net));
   card.append(el('span',title),value,el('small',summary.unknown||healthIssue?'סכום חלקי · '+summary.known+' יציאות חושבו':summary.count?summary.count+' יציאות חושבו':'אין יציאות בסינון זה'));totals.append(card);
  }
  const metric=el('div',null,'pnl-total');metric.append(el('span','יציאות ברווח / בהפסד'),el('strong',all.wins+' / '+all.losses),el('small',all.known?'שיעור רווחיות '+format(all.winRate,1)+'% · מתוך '+all.known+' יציאות מחושבות':'אין תוצאות מחושבות'));totals.append(metric);
  counts.textContent=rows.length+' יציאות בסינון'+(all.unknown?' · '+all.unknown+' ללא חישוב נטו; אינן נכללות בסיכום':'')+(all.flat?' · '+all.flat+' ללא רווח או הפסד':'');
  if(!rows.length){const r=el('tr'),cell=el('td','אין יציאות שמורות בטווח ובסינון שנבחרו.');cell.colSpan=9;r.append(cell);tbody.append(r);}
  for(const r of rows.slice(0,shown)){
   const tr=el('tr');const cell=(...children)=>{const td=el('td');td.append(...children);tr.append(td);};
   cell(el('b',r.symbol),el('small',r.direction+' · '+(r.status==='PARTIAL'?'יציאה חלקית':'סגירה'),'pnl-side '+r.direction.toLowerCase()));
   cell(el('span',when(r.entryAt)),el('small',when(r.closedAt)));
   cell(el('span','כניסה '+format(r.entryPrice,10)),el('small','יציאה '+format(r.exitPrice,10)));
   cell(el('span',format(r.qty,8)),el('small',format(r.costUsdt)+' USDT'));
   cell(el('span',feesText(r.fees),'pnl-numeric'));
   cell(el('span',signed(r.fundingUsdt),'pnl-numeric'));
   cell(el('b',signed(r.netPnlUsdt),'pnl-numeric '+tone(r.netPnlUsdt)));
   cell(el('span',numeric(r.netPnlPct)?signed(r.netPnlPct)+'%':'—','pnl-numeric '+tone(r.netPnlUsdt)));
   cell(el('span',reasonLabel(r.reason)),el('small',r.issue?issueLabel(r.issue):r.direction==='SHORT'?'ביצועים ומימון מבייננס':'לפי יומן הביצועים',r.issue?'unknown':''));tbody.append(tr);
  }
  more.hidden=rows.length<=shown;exportBtn.disabled=!rows.length;
 }
 async function load(force=false){
  if(context.mode!=='live'||!context.visible||busy||!force&&now()-lastAttempt<(context.refreshMs||15000))return;
  lastAttempt=now();const current=++request;busy=true;refresh.disabled=true;status.textContent='טוען רווח והפסד…';
  try{const next=await read();if(current!==request)return;if(!next?.ok||!Array.isArray(next.rows))throw Error('INVALID_REPORT');data=next;render();onData(data);}
  catch(error){if(current!==request)return;data=null;render();onData(null);status.textContent=error.status===401?'נדרש חיבור מכשיר לצפייה ברווח והפסד.':'לא ניתן לטעון את הדוח כרגע. נסה לרענן.';}
  finally{if(current===request){busy=false;refresh.disabled=false;}}
 }
 refresh.addEventListener('click',()=>load(true));exportBtn.addEventListener('click',()=>download(pnlCsv(filtered()),'LEVI-PnL-'+dateKey(now())+'.csv'));
 for(const input of [period,direction,sort,from,to])input.addEventListener('change',()=>{shown=25;render();});symbol.addEventListener('input',()=>{shown=25;render();});more.addEventListener('click',()=>{shown+=25;render();});
 function setContext(next){
  if(context.mode!==next.mode){request++;data=null;busy=false;lastAttempt=-Infinity;refresh.disabled=false;onData(null);}
  context={...context,...next};render();
  if(context.mode!=='live'){status.textContent=context.mode==='demo'?'הדוח מרכז מסחר LIVE. עבור ל־LIVE לצפייה.':'נדרש חיבור מכשיר לצפייה ברווח והפסד.';refresh.disabled=true;return;}
  if(context.visible)load();
 }
 render();return {load,setContext};
}

const host=document.getElementById('binanceTradingPnl');
if(host){
 const panel=createTradingPnlPanel(host,{onData:data=>window.dispatchEvent(new CustomEvent('levi:binance-pnl-data',{detail:data})),read:async()=>{
  const url=window.API_BASE+'/api/binance-trading-pnl',r=await fetch(window.binanceReadUrl(url),{headers:window.binanceReadHeaders(url),cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(!r.ok){const error=Error('PNL_UNAVAILABLE');error.status=r.status;throw error;}return r.json();
 },download:(content,name)=>{const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'})),link=el('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}});
 let mode=window.LEVI_DASHBOARD_SNAPSHOT?.mode||'disconnected';
 const overview=document.getElementById('terminalLedgers');
 const update=()=>panel.setContext({mode,visible:(!host.hidden||(overview&&!overview.hidden))&&!document.hidden,refreshMs:host.hidden?60000:15000});
 window.addEventListener('levi:trading-pnl-view',update);
 window.addEventListener('trade-device-expired',()=>{mode='disconnected';update();});
 window.addEventListener('levi:binance-dashboard',e=>{if(e.detail?.unauthorized)mode='disconnected';else if(e.detail?.mode)mode=e.detail.mode;update();});
 document.addEventListener('visibilitychange',update);setInterval(update,15000);update();
}
