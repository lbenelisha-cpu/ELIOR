const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
const num=n=>n==null?'—':Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const signed=n=>n==null?'—':(n>0?'+':'')+num(n);
const clock=at=>new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at));
const svgNode=(tag,attrs={},text)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value]of Object.entries(attrs))n.setAttribute(key,String(value));if(text!=null)n.textContent=text;return n;};
export function equitySegments(points,maxGap=150000){
 const groups=[];let group=[];
 for(const p of points){if(p.valueUsdt==null){if(group.length)groups.push(group);group=[];continue;}if(group.length&&p.at-group.at(-1).at>maxGap){groups.push(group);group=[];}group.push(p);}
 if(group.length)groups.push(group);return groups;
}
const israelDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'});
const accountLabels={SPOT:'LONG · Spot',FUTURES:'SHORT · Futures'};
const freshState=()=>({history:null,lastAttempt:-Infinity,busy:false,error:false});

function sessionSeries(points){
 const valid=points.filter(p=>p.valueUsdt!==null);
 if(!valid.length)return null;
 const first=valid[0],last=valid.at(-1),change=last.valueUsdt-first.valueUsdt;
 const values=valid.map(p=>p.valueUsdt);
 return {points,sessionOnly:true,unpricedAssets:[],stale:points.at(-1).valueUsdt===null,summary:{
  firstAt:first.at,lastAt:last.at,currentUsdt:last.valueUsdt,changeUsdt:change,
  changePct:first.valueUsdt>0?100*change/first.valueUsdt:null,lowUsdt:Math.min(...values),highUsdt:Math.max(...values)
 }};
}

export function createEquityPanel(host,{read,refreshFutures=()=>{},now=Date.now}){
 let mode=null,market='SPOT',selected=0,valid=[],sessionPoints=[],identity=null;
 let accounts={SPOT:freshState(),FUTURES:freshState()};
 const head=el('div',null,'equity-head'),intro=el('div');
 const eyebrow=el('span',null,'equity-eyebrow'),description=el('p');
 intro.append(eyebrow,el('h2','שווי התיק לאורך היום'),description);
 const selector=el('div',null,'equity-market');selector.setAttribute('role','group');selector.setAttribute('aria-label','בחירת חשבון לגרף השווי');
 const buttons={};
 for(const [venue,label] of Object.entries(accountLabels)){
  const button=el('button',label);button.type='button';button.dir='ltr';
  button.addEventListener('click',()=>{
   if(mode!=='live'||market===venue)return;
   market=venue;render();void load();
  });
  selector.append(button);buttons[venue]=button;
 }
 const refresh=el('button','רענון שווי התיק','text-action equity-refresh');refresh.type='button';head.append(intro,refresh);
 const status=el('p','חבר את המכשיר כדי לצפות בשווי התיק.','equity-status');status.setAttribute('role','status');
 const stats=el('div',null,'equity-stats'),fold=el('details',null,'equity-fold');fold.open=true;fold.append(el('summary','גרף השווי · פתיחה / סגירה'));
 const chart=el('div',null,'equity-chart'),selection=el('output',null,'equity-selection'),range=el('input');range.type='range';range.min='0';range.step='1';range.setAttribute('aria-label','בחר זמן מדידה בגרף');range.dir='ltr';
 const selectionWrap=el('div',null,'equity-selection-wrap');selectionWrap.append(selection,range);fold.append(chart,selectionWrap);
 const note=el('p',null,'equity-note');
 host.append(head,selector,status,stats,fold,note);
 function clear(){valid=[];stats.replaceChildren();chart.replaceChildren();selection.textContent='';range.value='0';fold.hidden=true;}
 function selectionText(){
  const p=valid[selected];if(!p)return;
  selection.textContent=clock(p.at)+' · '+num(p.valueUsdt)+' USDT';range.value=String(selected);range.setAttribute('aria-valuetext',selection.textContent);
  const dot=chart.querySelector?.('[data-equity-cursor]');if(dot){dot.setAttribute('cx',String(x(p.at)));dot.setAttribute('cy',String(y(p.valueUsdt)));}
 }
 let x=()=>0,y=()=>0;
 function render(){
  const isFutures=market==='FUTURES',state=accounts[market];
  const today=israelDay.format(now());
  sessionPoints=sessionPoints.filter(p=>israelDay.format(p.at)===today);
  const history=state.history;
  // A cached response must not carry yesterday's portfolio into the new Israel day.
  const recordedDay=history?.day||(history?.summary.lastAt?israelDay.format(history.summary.lastAt):today);
  let data=recordedDay===today?history:null;
  if(isFutures&&!data?.points.some(p=>p.valueUsdt!==null))data=sessionSeries(sessionPoints)||data;
  clear();
  eyebrow.textContent=isFutures?'BINANCE FUTURES · USDT':'BINANCE SPOT · USDT';
  description.textContent=isFutures?'יתרת ארנק Futures ב־USDT בתוספת רווח והפסד פתוח · שעון ישראל':'מזומן, מטבעות ויתרות נעולות · שעון ישראל';
  for(const [venue,button] of Object.entries(buttons))button.setAttribute('aria-pressed',String(venue===market));
  selector.hidden=refresh.hidden=note.hidden=mode!=='live';refresh.disabled=state.busy;
  if(mode!=='live'){status.textContent=mode==='demo'?'גרף התיק האמיתי זמין במצב LIVE.':'חבר את המכשיר כדי לצפות בשווי התיק.';return;}
  const sessionOnly=data?.sessionOnly;
  const scope=isFutures?'העברות אל ארנק Futures וממנו משפיעות על השינוי בשווי.':'שווי ארנק Spot כולל הפקדות ומשיכות.';
  const coverage=sessionOnly?'המדידות נאספו בזמן שהדף פתוח.':data?'השרת דוגם את השווי גם כשהאפליקציה סגורה.':'';
  note.textContent=[scope,coverage].filter(Boolean).join(' ');
  if(!data){status.textContent=state.error?(isFutures?'היסטוריית Futures אינה זמינה כרגע. ממתין למדידת שווי מהחשבון.':'לא ניתן לעדכן כעת את גרף השווי. נסה לרענן בעוד רגע.'):'טוען את מדידות שווי התיק…';return;}
  const s=data.summary;valid=data.points.filter(p=>p.valueUsdt!==null);fold.hidden=!valid.length;
  if(!valid.length){status.textContent=data.unpricedAssets?.length?'חסר מחיר ל־'+data.unpricedAssets.join(', '):'טרם התקבלה מדידת שווי להיום בחשבון '+accountLabels[market]+'.';return;}
  const refreshFailed=state.error&&!sessionOnly;
  const stale=refreshFailed||data.stale||now()-s.lastAt>150000;
  for(const [label,value,kind]of [[stale?'שווי אחרון שנמדד':'שווי התיק כעת',num(s.currentUsdt)+' USDT',''],['שינוי מהמדידה הראשונה',signed(s.changeUsdt)+' USDT',s.changeUsdt>0?'gain':s.changeUsdt<0?'loss':''],[sessionOnly?'הנמוך מאז הפתיחה':'הנמוך היום',num(s.lowUsdt)+' USDT',''],[sessionOnly?'הגבוה מאז הפתיחה':'הגבוה היום',num(s.highUsdt)+' USDT','']]){const cell=el('div');cell.append(el('span',label),el('strong',value,kind));if(label==='שינוי מהמדידה הראשונה')cell.append(el('small',s.changePct==null?'ללא בסיס לחישוב אחוז':signed(s.changePct)+'%'));stats.append(cell);}
  const day=new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',day:'numeric',month:'numeric',year:'numeric'}).format(new Date(s.firstAt));
  status.textContent=day+(sessionOnly?' · מדידות בזמן שהדף פתוח':'')+' · מדידות מ־'+clock(s.firstAt)+' · עדכון אחרון '+clock(s.lastAt)+(refreshFailed?' · הרענון נכשל, מוצגת המדידה האחרונה':stale?' · הנתונים אינם עדכניים':'')+(valid.length===1?' · נקודה ראשונה':'')+(data.unpricedAssets?.length?' · מחיר חסר: '+data.unpricedAssets.join(', '):'')+(data.storageError?' · שגיאת שמירה: המדידות החדשות עלולות לא להישמר באתחול':'');
  const width=1000,height=240,left=82,right=24,top=20,bottom=38,minAt=data.points[0].at,maxAt=data.points.at(-1).at;
  const span=Math.max(s.highUsdt-s.lowUsdt,Math.abs(s.highUsdt)*0.001,0.02),low=s.lowUsdt<0?s.lowUsdt-span*0.15:Math.max(0,s.lowUsdt-span*0.15),high=s.highUsdt+span*0.15;
  x=at=>minAt===maxAt?(left+width-right)/2:left+(at-minAt)/(maxAt-minAt)*(width-left-right);
  y=value=>height-bottom-(value-low)/(high-low)*(height-top-bottom);
  const svg=svgNode('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':'שווי תיק '+accountLabels[market]+' ב־USDT לאורך היום. מדידות מ־'+clock(s.firstAt)+' עד '+clock(s.lastAt)});
  for(let i=0;i<4;i++){const v=low+(high-low)*i/3,py=y(v);svg.append(svgNode('line',{x1:left,x2:width-right,y1:py,y2:py,class:'equity-grid'}),svgNode('text',{x:left-12,y:py+4,'text-anchor':'end',class:'equity-axis'},num(v)));}
  const ticks=minAt===maxAt?[minAt]:Array.from({length:5},(_,i)=>minAt+(maxAt-minAt)*i/4);
  for(const at of ticks)svg.append(svgNode('text',{x:x(at),y:height-9,'text-anchor':'middle',class:'equity-axis'},clock(at)));
  const color=s.changeUsdt<0?'loss':'gain';
  for(const group of equitySegments(data.points)){
   const line=group.map(p=>x(p.at)+','+y(p.valueUsdt)).join(' ');
   if(group.length>1){svg.append(svgNode('polygon',{points:line+' '+x(group.at(-1).at)+','+(height-bottom)+' '+x(group[0].at)+','+(height-bottom),class:'equity-area '+color}),svgNode('polyline',{points:line,class:'equity-line '+color}));}
   else svg.append(svgNode('circle',{cx:x(group[0].at),cy:y(group[0].valueUsdt),r:4,class:'equity-dot '+color}));
  }
  svg.append(svgNode('circle',{'data-equity-cursor':'',r:5,class:'equity-cursor'}));chart.append(svg);
  if(equitySegments(data.points).length>1)chart.append(el('small','פערים בקו מציינים זמנים ללא מדידה מלאה.','equity-gap'));
  selected=valid.length-1;range.max=String(selected);range.disabled=valid.length<2;selectionText();
  svg.addEventListener('pointermove',event=>{const rect=svg.getBoundingClientRect(),px=(event.clientX-rect.left)/rect.width*width;selected=valid.reduce((best,p,i)=>Math.abs(x(p.at)-px)<Math.abs(x(valid[best].at)-px)?i:best,0);selectionText();});
 }
 async function load(force=false){
  const venue=market,state=accounts[venue];
  if(mode!=='live'||state.busy||(!force&&now()-state.lastAttempt<60000))return;
  state.lastAttempt=now();state.busy=true;refresh.disabled=true;
  try{
   const result=await read(venue);
   if(state!==accounts[venue])return;
   const correctMarket=venue==='FUTURES'?result?.market==='FUTURES'&&result.source==='BINANCE_FUTURES_USDT_ACCOUNT_SNAPSHOTS':
    (!result?.market||result.market==='SPOT')&&(!result?.source||result.source==='BINANCE_SPOT_ACCOUNT_SNAPSHOTS');
   if(!correctMarket||!result?.ok||!Array.isArray(result.points)||!result.summary){
    state.history=null;state.error=true;return;
   }
   state.history=result;state.error=false;
  }catch(error){
   if(state!==accounts[venue])return;
   if(error.status===401||error.status===403){setContext({unauthorized:true});return;}
   const transient=!error.status||error.status>=500||[408,429].includes(error.status);
   if(venue==='SPOT'||!transient)state.history=null;
   state.error=true;
  }finally{
   if(state===accounts[venue]){state.busy=false;if(market===venue)render();}
  }
 }
 function setContext(context){
  const next=context.unauthorized?'disconnected':context.mode;
  if(mode!==next||identity!==context.identity){
   mode=next;identity=context.identity;accounts={SPOT:freshState(),FUTURES:freshState()};sessionPoints=[];
   if(mode!=='live')market='SPOT';
   render();
  }
  if(mode==='live'&&context.visible!==false)void load();
 }
 function observeFutures(observation){
  if(mode!=='live'||!observation)return;
  const {at,valueUsdt}=observation,time=now();
  if(!Number.isSafeInteger(at)||at<=0||at>time+5000||time-at>120000||israelDay.format(at)!==israelDay.format(time))return;
  if(valueUsdt!==null&&!Number.isFinite(valueUsdt))return;
  const prior=sessionPoints.at(-1);
  if(prior&&at<=prior.at)return;
  sessionPoints=sessionPoints.filter(p=>israelDay.format(p.at)===israelDay.format(at));
  if(prior&&Math.floor(prior.at/60000)===Math.floor(at/60000)&&(prior.valueUsdt===null)===(valueUsdt===null)){
   // Retain one reading per minute, preserving a boundary at a failed observation.
   sessionPoints.pop();
  }
  sessionPoints.push({at,valueUsdt});
  if(market==='FUTURES'&&!accounts.FUTURES.history?.points.some(p=>p.valueUsdt!==null))render();
 }
 refresh.addEventListener('click',()=>{
  if(market==='FUTURES'&&!accounts.FUTURES.history?.points.some(p=>p.valueUsdt!==null))refreshFutures();
  void load(true);
 });range.addEventListener('input',()=>{selected=Number(range.value);selectionText();});render();
 return {load,setContext,observeFutures,tick(){if(mode==='live'){render();if(!host.hidden)void load();}}};
}
const host=document.getElementById('binanceEquityPanel');
if(host){
 const panel=createEquityPanel(host,{refreshFutures:()=>window.dispatchEvent(new Event('levi:refresh-futures-equity')),read:async market=>{
  const url=window.API_BASE+'/api/binance-equity-history'+(market==='FUTURES'?'?market=FUTURES':'');
  const response=await fetch(window.binanceReadUrl(url),{headers:window.binanceReadHeaders(url),cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok){const error=Error();error.status=response.status;throw error;}return response.json();
 }});
 let lastContext={};
 const context=detail=>{
  lastContext=detail;
  const identity=window.LEVI_TRADE_AUTH?.read();
  panel.setContext({...detail,unauthorized:detail.unauthorized||!identity,identity,visible:!host.hidden});
 };
 window.addEventListener('levi:binance-dashboard',event=>context(event.detail));
 window.addEventListener('trade-device-expired',()=>context({unauthorized:true}));
 window.addEventListener('levi:futures-equity-observed',event=>{
  context(lastContext);panel.observeFutures(event.detail);
 });
 if(window.LEVI_DASHBOARD_SNAPSHOT)context(window.LEVI_DASHBOARD_SNAPSHOT);
 const tick=()=>{context(lastContext);panel.tick();};
 setInterval(()=>{if(!document.hidden)tick();},15000);
 window.addEventListener('focus',tick);
}
