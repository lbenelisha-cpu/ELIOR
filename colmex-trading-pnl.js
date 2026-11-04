// Display-only report from the existing server journal. No broker/order writes.
const numeric=n=>typeof n==='number'&&Number.isFinite(n);
const validTime=t=>numeric(t)&&t>0&&t<8640000000000000;
const dateKey=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
const when=t=>validTime(t)?new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',dateStyle:'short',timeStyle:'short',hourCycle:'h23'}).format(new Date(t)):'—';
const format=n=>numeric(n)?n.toLocaleString('en-US',{maximumFractionDigits:4}):'—';
const signed=n=>numeric(n)?(n>0?'+':'')+format(n):'—';
const tone=n=>!numeric(n)?'unknown':n>0?'gain':n<0?'loss':'flat';
const issueText=issue=>({QUANTITY_CHANGED:'כמות שונתה · עלות היציאה אינה מאומתת',MISSING_EXECUTION:'ממתין למחיר ביצוע מאומת',FEES_UNVERIFIED:'עמלות ונטו טרם אומתו',INVALID_DATE:'מועד תיעוד הסגירה אינו תקין'})[issue]||'נתונים חסרים';
const reasonText=reason=>({CHANNEL_TAKE_PROFIT:'יעד תעלת קיצון',CHANNEL_STOP_LOSS:'סטופ הפסד',TAKE_PROFIT:'יעד רווח',STOP_LOSS:'סטופ הפסד',TRAILING_PROFIT_EXIT:'הגנת רווח נגררת',BROKER_OR_EXTERNAL_CLOSE:'סגירה בברוקר / מחוץ לבוט',MANUAL_STOP_ALL:'עצירה ידנית'})[reason]||reason||'לא תועדה';
export function colmexPnlRows(trades,now=Date.now()){
 return trades.map(t=>{
  const closedAt=validTime(t.closedObservedAt)&&t.closedObservedAt<=now?t.closedObservedAt:null;
  const rawCost=!t.accountingAdjusted&&numeric(t.qty)&&t.qty>0&&numeric(t.entryPrice)&&t.entryPrice>0?t.qty*t.entryPrice:null,cost=numeric(rawCost)?rawCost:null;
  const verified=!t.accountingAdjusted&&t.accountingStatus==='FEES_UNVERIFIED'&&Array.isArray(t.exitOrderIds)&&t.exitOrderIds.length>0&&cost>0&&numeric(t.exitPrice)&&t.exitPrice>0&&numeric(t.grossPnl);
  const gross=verified?t.grossPnl:null;
  // The current LIVE journal does not verify fees. Never promote gross to net.
  return {symbol:String(t.symbol||'—'),direction:t.side==='SHORT'?'SHORT':'LONG',qty:numeric(t.qty)?t.qty:null,entryPrice:numeric(t.entryPrice)?t.entryPrice:null,exitPrice:numeric(t.exitPrice)?t.exitPrice:null,entryAt:validTime(t.entryAt)?t.entryAt:null,closedAt,cost,gross,net:null,fees:null,grossPct:gross!==null&&cost>0?gross/cost*100:null,reason:reasonText(t.reason),issue:!closedAt?'INVALID_DATE':t.accountingAdjusted?'QUANTITY_CHANGED':verified?'FEES_UNVERIFIED':'MISSING_EXECUTION'};
 });
}
export function filterColmexPnl(rows,{period='30',symbol='',from='',to='',sort='newest'}={},now=Date.now()){
 const today=dateKey(now),start=period==='today'?today:['7','30','90'].includes(period)?dateKey(now-(Number(period)-1)*86400000):period==='custom'?from:'',end=period==='custom'?to:today,search=symbol.trim().toUpperCase();
 return rows.filter(r=>r.symbol.toUpperCase().includes(search)&&r.closedAt&&(!start||dateKey(r.closedAt)>=start)&&(!end||dateKey(r.closedAt)<=end)).sort((a,b)=>sort==='profit'?(a.gross===null?b.gross===null?0:1:b.gross===null?-1:b.gross-a.gross):b.closedAt-a.closedAt);
}
export function summarizeColmexPnl(rows){
 const known=rows.filter(r=>numeric(r.gross)),wins=known.filter(r=>r.gross>0).length,losses=known.filter(r=>r.gross<0).length;
 return {count:rows.length,known:known.length,unknown:rows.length-known.length,gross:known.length?known.reduce((sum,r)=>sum+r.gross,0):null,net:null,wins,losses,flat:known.length-wins-losses,winRate:known.length?wins/known.length*100:null};
}
export function colmexPnlCsv(rows){
 const cell=v=>{const s=v==null?'':String(v),safe=typeof v==='string'&&/^[=+\-@\t\r]/.test(s)?"'"+s:s;return '"'+safe.replaceAll('"','""')+'"';};
 return '\uFEFF'+[['נכס','כיוון','מועד כניסה · ישראל','מועד זיהוי הסגירה · ישראל','כמות','מחיר כניסה USD','מחיר יציאה USD','עלות מיוחסת USD','רווח גולמי USD','תשואה גולמית %','עמלות USD','רווח נטו USD','סיבת סגירה','אימות'],...rows.map(r=>[r.symbol,r.direction,when(r.entryAt),when(r.closedAt),r.qty,r.entryPrice,r.exitPrice,r.cost,r.gross,r.grossPct,r.fees,r.net,r.reason,issueText(r.issue)])].map(row=>row.map(cell).join(',')).join('\r\n');
}
export function createColmexPnlPanel(host,{refresh=()=>{},download=()=>{},now=Date.now,onSummary=()=>{}}={}){
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
 let data=null,asOf=null,failed=false,shown=25;
 const heading=el('div',null,'pnl-heading'),intro=el('div');intro.append(el('span','COLMEX PRO · USD','pnl-eyebrow'),el('h2','רווח והפסד מהמסחר'),el('p','סגירות שבמעקב הבוט · מחירי ביצוע ותוצאות במקום אחד'));
 const refreshBtn=el('button','רענן נתונים','secondary'),exportBtn=el('button','ייצוא CSV לאקסל','secondary');refreshBtn.type=exportBtn.type='button';heading.append(intro,refreshBtn,exportBtn);
 const controls=el('div',null,'pnl-controls');
 function select(label,choices){const wrap=el('label',label),input=el('select');input.setAttribute('aria-label',label);for(const [value,text]of choices){const option=el('option',text);option.value=value;input.append(option);}wrap.append(input);controls.append(wrap);return input;}
 const period=select('תקופה',[['30','30 ימים'],['today','היום'],['7','7 ימים'],['90','90 ימים'],['all','כל 100 הסגירות הזמינות'],['custom','טווח תאריכים']]);
 const symbolWrap=el('label','חיפוש נכס'),symbol=el('input');symbol.placeholder='למשל AAPL או SPY';symbol.dir='ltr';symbol.setAttribute('aria-label','חיפוש נכס ברווח והפסד');symbolWrap.append(symbol);controls.append(symbolWrap);
 const sort=select('מיון',[['newest','מהחדש לישן'],['profit','לפי רווח גולמי']]);
 const fromWrap=el('label','מתאריך'),toWrap=el('label','עד תאריך'),from=el('input'),to=el('input');from.type=to.type='date';from.setAttribute('aria-label','מתאריך');to.setAttribute('aria-label','עד תאריך');fromWrap.append(from);toWrap.append(to);controls.append(fromWrap,toWrap);
 const status=el('p',null,'pnl-status');status.setAttribute('role','status');
 const totals=el('div',null,'pnl-totals'),counts=el('p',null,'pnl-counts'),wrap=el('div',null,'pnl-table-wrap'),table=el('table',null,'pnl-table');table.setAttribute('aria-label','רווח והפסד Colmex');
 const thead=el('thead'),tr=el('tr');for(const text of ['נכס / כיוון','כניסה ← זיהוי סגירה','מחירי ביצוע · USD','כמות / עלות · USD','רווח גולמי · USD','תשואה גולמית','עמלות / נטו · USD','סיבת סגירה / אימות']){const th=el('th',text);th.scope='col';tr.append(th);}thead.append(tr);const tbody=el('tbody');table.append(thead,tbody);wrap.append(table);
 const more=el('button','הצג עוד 25 סגירות','secondary');more.type='button';
 const note=el('p','הדוח כולל עד 100 סגירות אחרונות של פוזיציות שבמעקב הבוט, כולל החזקות ידניות שאומצו לניהול. הדוח כולל פוזיציות LONG ו־SHORT. הסינון לפי זמן זיהוי הסגירה בשעון ישראל, שאינו בהכרח זמן הביצוע בברוקר. רווח גולמי ותשואה מחושבים רק כשמחירי הביצוע והכמות מאומתים; העמלות והרווח נטו עדיין אינם מאומתים. שינוי כמות או מכירה חלקית מחוץ לבוט עשויים להשאיר נתונים חסרים. נתון חסר אינו אפס. רווח פתוח, העברות והפקדות אינם נכללים בסיכום.','pnl-note');
 host.append(heading,controls,status,totals,counts,wrap,more,note);
 const filtered=()=>filterColmexPnl(data||[],{period:period.value,symbol:symbol.value,from:from.value,to:to.value,sort:sort.value},now());
 function render(){
  totals.replaceChildren();tbody.replaceChildren();counts.textContent='';more.hidden=true;exportBtn.disabled=true;fromWrap.hidden=toWrap.hidden=period.value!=='custom';
  if(!data){status.textContent=failed?'לא ניתן לקרוא את יומן המסחר כרגע. לחץ על רענן נתונים.':'ממתין ליומן המסחר…';onSummary(status.textContent);return;}
  if(period.value==='custom'&&from.value&&to.value&&from.value>to.value){status.textContent='תאריך ההתחלה חייב להיות לפני תאריך הסיום.';return;}
  const rows=filtered(),s=summarizeColmexPnl(rows),invalid=data.filter(r=>!r.closedAt).length;
  status.textContent='היומן נקרא '+when(asOf)+' · עד 100 סגירות אחרונות'+(invalid?' · '+invalid+' רשומות ללא תאריך תקין אינן נכללות':'');
  onSummary(s.count+' סגירות בסינון · '+(s.gross===null?'רווח גולמי טרם חושב':'רווח גולמי '+signed(s.gross)+' USD')+' · נטו לא מאומת');
  function card(label,value,note,cls){const c=el('div',null,'pnl-total');c.append(el('span',label),el('strong',value,cls),el('small',note));totals.append(c);}
  card('רווח / הפסד ממומש גולמי',signed(s.gross)+' USD',s.unknown?'סכום חלקי · '+s.known+' סגירות חושבו':s.count?s.known+' סגירות חושבו · לפני עמלות':'אין סגירות בסינון זה',tone(s.gross));
  card('רווח / הפסד ממומש נטו','—','ממתין לאימות עמלות','unknown');
  card('סגירות ברווח / בהפסד',s.wins+' / '+s.losses,s.known?'שיעור רווחיות גולמי '+format(s.winRate)+'%':'אין תוצאות מחושבות');
  card('סגירות מתועדות',String(s.count),s.unknown?s.unknown+' ללא חישוב גולמי':s.flat?s.flat+' ללא רווח או הפסד גולמי':'לפי הסינון שנבחר');
  counts.textContent=rows.length+' סגירות בסינון'+(s.unknown?' · '+s.unknown+' ללא חישוב גולמי; אינן נכללות בסיכום':'');
  if(!rows.length){const row=el('tr'),cell=el('td','אין סגירות שמורות בטווח ובסינון שנבחרו.');cell.colSpan=8;row.append(cell);tbody.append(row);}
  for(const r of rows.slice(0,shown)){const row=el('tr'),cell=(...nodes)=>{const td=el('td');td.append(...nodes);row.append(td);};
   cell(el('b',r.symbol),el('small',r.direction,'pnl-side '+r.direction.toLowerCase()));
   cell(el('span',when(r.entryAt)),el('small',when(r.closedAt)));
   cell(el('span','כניסה '+format(r.entryPrice)),el('small','יציאה '+format(r.exitPrice)));
   cell(el('span',format(r.qty)),el('small',format(r.cost)+' USD'));
   cell(el('b',signed(r.gross),'pnl-numeric '+tone(r.gross)));
   cell(el('span',r.grossPct===null?'—':signed(r.grossPct)+'%','pnl-numeric '+tone(r.gross)));
   cell(el('span','—','unknown'),el('small','לא מאומת'));
   cell(el('span',r.reason),el('small',issueText(r.issue),'unknown'));tbody.append(row);
  }
  more.hidden=rows.length<=shown;exportBtn.disabled=!rows.length;
 }
 function setData(snapshot,error=false){failed=error;data=!error&&Array.isArray(snapshot?.closedTrades)?colmexPnlRows(snapshot.closedTrades,now()):null;asOf=now();render();}
 refreshBtn.addEventListener('click',()=>{status.textContent='מרענן את יומן המסחר…';refresh();});
 exportBtn.addEventListener('click',()=>{if(data)download(colmexPnlCsv(filtered()),'LEVI-Colmex-PnL-'+dateKey(now())+'.csv');});
 for(const input of [period,sort,from,to])input.addEventListener('change',()=>{shown=25;render();});symbol.addEventListener('input',()=>{shown=25;render();});more.addEventListener('click',()=>{shown+=25;render();});
 render();return {setData};
}
const host=typeof document!=='undefined'?document.getElementById('colmexTradingPnl'):null;
if(host){
 const panel=createColmexPnlPanel(host,{refresh:()=>document.getElementById('autoMonitorRefresh').click(),onSummary:text=>{document.getElementById('colmexClosedSummary').textContent=text;},download:(content,name)=>{const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}});
 panel.setData(window.LEVI_COLMEX_STATUS?.data,window.LEVI_COLMEX_STATUS?.error);
 window.addEventListener('levi-colmex-rsi',event=>panel.setData(event.detail));window.addEventListener('levi:colmex-status-error',()=>panel.setData(null,true));
 document.getElementById('colmexOpenPnlReport').addEventListener('click',()=>{const section=document.getElementById('colmexClosedTrades');section.open=true;section.scrollIntoView({behavior:'smooth',block:'start'});});
}
