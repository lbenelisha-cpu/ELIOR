const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;if(cls)node.className=cls;return node;};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const money=x=>finite(x)?x.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
const signed=x=>finite(x)?(x>0?'+':'')+money(x):'—';
const price=x=>finite(x)&&x>0?x.toLocaleString('en-US',{maximumSignificantDigits:9}):'—';
const time=x=>{const n=typeof x==='number'?x:Date.parse(x);return Number.isFinite(n)?new Date(n).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}):'—';};
const signClass=x=>finite(x)?x>0?'gain':x<0?'loss':'flat':'unknown';
const statusLabel=x=>({WAITING:'ממתין לחציית POC',EXECUTING:'בביצוע',UNKNOWN:'ממתין לאימות ביצוע',FILLED:'בוצעה',CLOSED:'נסגרה',NO_FILL:'לא מולאה',FAILED:'נכשלה'}[x]||x||'—');

export function createLiveMonitor(host,{read,now=Date.now}){
 let data=null,busy=false,connected=false,generation=0;
 const compact=host.dataset?.compact==='true';
 if(compact)host.classList.add('live-monitor-integrated');
 const heading=el('div',null,'live-monitor-heading'),intro=el('div');
 intro.append(el('span','BINANCE · LIVE','live-monitor-badge'),el('h2','מעקב מסחר LIVE'),el('p','יתרות, פוזיציות ותוצאות מהחשבון האמיתי בלבד.'));
 const refresh=el('button','רענן נתוני LIVE','live-monitor-refresh');refresh.type='button';heading.append(intro,refresh);
 const status=el('p','ממתין לחיבור מאובטח לחשבון LIVE.','live-monitor-status');status.setAttribute('role','status');
 const metrics=el('div',null,'live-monitor-metrics'),pocState=el('section',null,'live-monitor-poc'),tables=el('div',null,'live-monitor-tables');
 host.replaceChildren(heading,status,metrics,pocState,tables);
 if(compact){intro.hidden=true;refresh.textContent='רענון יתרות LIVE';}
 function setSummaryReady(value){if(compact)document.body.classList.toggle('integrated-live-ready',value);}
 function metric(label,value,note,cls=''){const card=el('article',null,'live-monitor-card');card.append(el('span',label),el('strong',value,cls),el('small',note));metrics.append(card);}
 function table(title,columns,rows,empty){
  const section=el(compact?'details':'section',null,'live-monitor-table-card');section.append(el(compact?'summary':'h3',title));
  const wrap=el('div',null,'live-monitor-table-wrap'),table=el('table'),head=el('thead'),hr=el('tr'),body=el('tbody');
  for(const column of columns)hr.append(el('th',column));head.append(hr);table.append(head,body);
  if(rows.length){for(const values of rows){const tr=el('tr');for(const value of values){const td=el('td');td.append(value instanceof Node?value:el('span',String(value??'—')));tr.append(td);}body.append(tr);}}
  else{const tr=el('tr'),td=el('td',empty);td.colSpan=columns.length;tr.append(td);body.append(tr);}
  wrap.append(table);section.append(wrap);tables.append(section);
 }
 function asset(symbol,market){const node=el('span',symbol);globalThis.LEVI_ASSET_CHART?.append(node,symbol,market);return node;}
 function render(){
  metrics.replaceChildren();pocState.replaceChildren();tables.replaceChildren();
  setSummaryReady(!!data);
  if(!data)return;
  const s=data.spot||{},f=data.futures||{},realized=data.realized||{};
  const shortOpen=f.ok&&(f.positions||[]).every(p=>finite(p.unrealizedPnlUsdt))?(f.positions||[]).reduce((n,p)=>n+p.unrealizedPnlUsdt,0):null;
  if(compact){
   const grid=el('table',null,'live-account-summary');grid.setAttribute('aria-label','יתרות ותוצאות LONG ו-SHORT');
   const head=el('thead'),hr=el('tr');for(const label of ['מסלול','שווי / ארנק','זמין','רווח פתוח','ממומש · היסטוריה'])hr.append(el('th',label));head.append(hr);grid.append(head);
   const body=el('tbody');
   for(const [label,value,cash,pnl,result] of [['LONG · Spot',s.equityUsdt,s.availableUsdt,s.openPnlUsdt,realized.long],['SHORT · Futures',f.ok?f.walletUsdt:null,f.ok?f.availableUsdt:null,shortOpen,realized.short]]){
    const row=el('tr');row.append(el('th',label));
    for(const [i,n] of [value,cash,pnl,result?.net].entries()){const cell=el('td',i>1?signed(n):money(n),i>1?signClass(n):'');if(i===3)cell.append(el('small',(result?.known||0)+' מחושבות · '+(result?.unknown||0)+' ללא אימות'));row.append(cell);}body.append(row);
   }grid.append(body);metrics.append(grid);
   metrics.append(el('small','כל הסכומים ב־USDT · שווי Spot וארנק Futures נפרדים · רווח ממומש מכל ההיסטוריה הזמינה, לא רק היום.'));
  }else{
  metric('LONG · שווי Spot',money(s.equityUsdt)+' USDT','כולל מזומן ונכסים בחשבון');
  metric('LONG · מזומן זמין',money(s.availableUsdt)+' USDT','יתרת USDT חופשית');
  metric('LONG · רווח פתוח',signed(s.openPnlUsdt)+' USDT','רק אם עלות הקנייה אומתה',signClass(s.openPnlUsdt));
  metric('SHORT · ארנק Futures',money(f.walletUsdt)+' USDT',f.ok?'עדכון '+time(data.asOf):'לא ניתן לאמת יתרת Futures');
  metric('SHORT · זמין',money(f.availableUsdt)+' USDT',f.ok?'לפי חשבון USDⓈ-M':'היתרה אינה מאומתת');
  metric('SHORT · רווח פתוח',signed(shortOpen)+' USDT',f.ok?'לפי מחיר הסימון בבורסה':'לא זמין',signClass(shortOpen));
  metric('LONG · רווח ממומש',signed(realized.long?.net)+' USDT',(realized.long?.known||0)+' עסקאות מחושבות · '+(realized.long?.unknown||0)+' ללא אימות',signClass(realized.long?.net));
  metric('SHORT · רווח ממומש',signed(realized.short?.net)+' USDT',(realized.short?.known||0)+' עסקאות מחושבות · '+(realized.short?.unknown||0)+' ללא אימות',signClass(realized.short?.net));
  }
  status.textContent='נתוני LIVE אומתו ב־'+time(data.asOf)+(f.ok?' · Spot ו־Futures':' · Futures לא זמין: '+(f.error||'שגיאה'));
  const enabled=data.poc?.enabled===true,ready=data.poc?.executionReady===true;
  const state=el('div',null,'live-monitor-poc-state '+(ready?'ready':enabled?'attention':'paused'));
  state.append(el('b',ready?'POC LIVE · בדיקות השרת מוכנות':enabled?'POC LIVE · מופעל אך עדיין לא מוכן לכניסה':'POC אוטומטי · כבוי'),
    el('span',`${(data.poc?.pendingSetups||[]).length} תבניות ממתינות · ${(data.poc?.executions||[]).filter(x=>['FILLED','CLOSED'].includes(x.status)).length} ביצועים אמיתיים ביומן`));
  if(data.poc?.error||data.poc?.fatal)state.append(el('small','מצב מנגנון: '+(data.poc.fatal||data.poc.error)));
  pocState.append(el('h3','מצב מנגנון POC'),state);
  const spotRows=(s.positions||[]).map(p=>[asset(p.symbol,'SPOT'),money(p.quantity),price(p.markPrice),money(p.valueUsdt)+' USDT',signed(p.unrealizedPnlUsdt)+' USDT',finite(p.pnlPct)?signed(p.pnlPct)+'%':'—']);
  if(!compact)table('נכסים מוחזקים · Spot LONG',['נכס','כמות','מחיר נוכחי','שווי','רווח פתוח','שינוי'],spotRows,
    s.unpricedAssets?.length?'אין נכסים מתומחרים; חסר מחיר עבור '+s.unpricedAssets.join(', '):'אין כרגע נכסי Spot בחשבון.');
  const futuresRows=(f.positions||[]).filter(p=>!compact||!p.managed).map(p=>[asset(p.symbol,'FUTURES'),p.quantity>0?'LONG':'SHORT',money(Math.abs(p.quantity)),price(p.entryPrice),price(p.markPrice),signed(p.unrealizedPnlUsdt)+' USDT',p.managed?'מנוהל בבוט':'לא משויך ליומן הבוט']);
  if(!compact||futuresRows.length)table(compact?'Futures · פוזיציות שאינן משויכות לבוט':'פוזיציות פתוחות · Futures',['נכס','כיוון','כמות','כניסה','מחיר סימון','רווח פתוח','שיוך'],futuresRows,f.ok?'אין כרגע פוזיציות Futures פתוחות.':'לא ניתן לאמת פוזיציות Futures.');
  const setups=(data.poc?.pendingSetups||[]).map(x=>[asset(x.symbol,x.side==='SHORT'?'FUTURES':'SPOT'),x.side,price(x.poc),price(x.structuralStop),statusLabel(x.status||'WAITING'),time(x.expiresAt)]);
  if(!compact||setups.length)table('המתנות POC · LIVE',['נכס','כיוון','POC','רמה מבנית','מצב','תוקף'],setups,'אין כרגע הוראות POC ממתינות.');
  const executions=(data.poc?.executions||[]).map(x=>[asset(x.symbol,x.side==='SHORT'?'FUTURES':'SPOT'),x.side,statusLabel(x.status),time(x.intentAt),x.result?.order?.executedQty??x.result?.executedQty??'—',x.error||x.result?.error||'—']);
  if(!compact||executions.length)table('יומן ביצועי POC · LIVE',['נכס','כיוון','מצב','זמן ניסיון','כמות שבוצעה','פרטים'],executions,'עדיין אין ביצועי POC ביומן LIVE.');
 }
 async function load(){if(!connected||busy)return;busy=true;const request=++generation;refresh.disabled=true;
  try{const next=await read();if(request!==generation)return;if(!next?.ok||next.mode!=='live'||!next.spot)throw Error('LIVE_DATA_UNAVAILABLE');data=next;render();}
  catch(error){if(request!==generation)return;data=null;render();status.textContent=error.status===401?'נדרש חיבור מכשיר לצפייה בחשבון LIVE.':error.status===409?'המעקב מציג רק חשבון LIVE; מצב החשבון הנוכחי אינו LIVE.':'לא ניתן לאמת כרגע נתוני LIVE. נתונים קודמים הוסתרו.';}
  finally{if(request===generation){busy=false;refresh.disabled=false;}}
 }
 function setConnected(value){if(value===connected)return;connected=value;generation++;busy=false;data=null;render();refresh.disabled=!value;status.textContent=value?'טוען נתוני LIVE…':'נדרש חיבור מאובטח לחשבון LIVE.';if(value)void load();}
 refresh.addEventListener('click',load);setConnected(Boolean(window.LEVI_TRADE_AUTH?.read()));
 window.addEventListener('levi:binance-dashboard',()=>setConnected(Boolean(window.LEVI_TRADE_AUTH?.read())));
 window.addEventListener('trade-device-expired',()=>setConnected(false));
 setInterval(()=>{setConnected(Boolean(window.LEVI_TRADE_AUTH?.read()));if(!document.hidden&&!host.hidden)void load();},15000);
 return {load,setConnected};
}

const host=document.getElementById('pocLiveMonitor');
if(host)createLiveMonitor(host,{read:async()=>{
 const url=window.API_BASE+'/api/binance-poc-live-monitor',response=await fetch(window.binanceReadUrl(url),{headers:window.binanceReadHeaders(url),cache:'no-store',signal:AbortSignal.timeout(25000)});
 if(!response.ok){const error=Error('LIVE_MONITOR_READ_FAILED');error.status=response.status;throw error;}return response.json();
}});
