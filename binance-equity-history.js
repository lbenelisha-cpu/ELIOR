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
export function createEquityPanel(host,{read,now=Date.now}){
 let data=null,mode=null,busy=false,generation=0,lastAttempt=-Infinity,selected=0,valid=[];
 const head=el('div',null,'equity-head'),intro=el('div');intro.append(el('span','BINANCE SPOT · USDT','equity-eyebrow'),el('h2','שווי התיק לאורך היום'),el('p','מזומן, מטבעות ויתרות נעולות · לפי שעון ישראל'));
 const refresh=el('button','רענן','text-action');refresh.type='button';head.append(intro,refresh);
 const status=el('p','חבר את המכשיר כדי לצפות בשווי התיק.','equity-status');status.setAttribute('role','status');
 const stats=el('div',null,'equity-stats'),fold=el('details',null,'equity-fold');fold.open=true;fold.append(el('summary','גרף השווי · פתיחה / סגירה'));
 const chart=el('div',null,'equity-chart'),selection=el('output',null,'equity-selection'),range=el('input');range.type='range';range.min='0';range.step='1';range.setAttribute('aria-label','בחר זמן מדידה בגרף');range.dir='ltr';
 const selectionWrap=el('div',null,'equity-selection-wrap');selectionWrap.append(selection,range);fold.append(chart,selectionWrap);
 const note=el('p','שינוי בשווי כולל גם הפקדות ומשיכות, ואינו רווח ממסחר בלבד. הנתונים כוללים את ארנק Spot; ללא Futures, Margin או Earn. המדידה נשמרת בשרת פעם בדקה, גם כשהאפליקציה סגורה.','equity-note');
 host.append(head,status,stats,fold,note);
 function clear(){data=null;valid=[];stats.replaceChildren();chart.replaceChildren();selection.textContent='';range.value='0';fold.hidden=true;}
 function selectionText(){
  const p=valid[selected];if(!p)return;
  selection.textContent=clock(p.at)+' · '+num(p.valueUsdt)+' USDT';range.value=String(selected);range.setAttribute('aria-valuetext',selection.textContent);
  const dot=chart.querySelector?.('[data-equity-cursor]');if(dot){dot.setAttribute('cx',String(x(p.at)));dot.setAttribute('cy',String(y(p.valueUsdt)));}
 }
 let x=()=>0,y=()=>0;
 function render(){
  stats.replaceChildren();chart.replaceChildren();if(!data){fold.hidden=true;return;}
  const s=data.summary;valid=data.points.filter(p=>p.valueUsdt!==null);fold.hidden=!valid.length;
  if(!valid.length){status.textContent=data.unpricedAssets.length?'לא ניתן לחשב שווי מלא: חסר מחיר ל־'+data.unpricedAssets.join(', '):'המדידה הופעלה. השווי הראשון יוצג לאחר קבלת נתונים מבייננס.';return;}
  const stale=data.stale||now()-s.lastAt>150000;
  for(const [label,value,kind]of [[stale?'שווי אחרון שנמדד':'שווי התיק כעת',num(s.currentUsdt)+' USDT',''],['שינוי מהמדידה הראשונה',signed(s.changeUsdt)+' USDT',s.changeUsdt>0?'gain':s.changeUsdt<0?'loss':''],['הנמוך היום',num(s.lowUsdt)+' USDT',''],['הגבוה היום',num(s.highUsdt)+' USDT','']]){const cell=el('div');cell.append(el('span',label),el('strong',value,kind));if(label==='שינוי מהמדידה הראשונה')cell.append(el('small',s.changePct==null?'ללא בסיס לחישוב אחוז':signed(s.changePct)+'%'));stats.append(cell);}
  const day=new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',day:'numeric',month:'numeric',year:'numeric'}).format(new Date(s.firstAt));
  status.textContent=day+' · מדידות מ־'+clock(s.firstAt)+' · עדכון אחרון '+clock(s.lastAt)+(stale?' · הנתונים אינם עדכניים':'')+(valid.length===1?' · נקודה ראשונה; הגרף יתמלא בהמשך היום':'')+(data.unpricedAssets.length?' · מחיר חסר: '+data.unpricedAssets.join(', '):'')+(data.storageError?' · שגיאת שמירה: המדידות החדשות עלולות לא להישמר באתחול':'');
  const width=1000,height=240,left=82,right=24,top=20,bottom=38,minAt=data.points[0].at,maxAt=data.points.at(-1).at;
  const span=Math.max(s.highUsdt-s.lowUsdt,Math.abs(s.highUsdt)*0.001,0.02),low=Math.max(0,s.lowUsdt-span*0.15),high=s.highUsdt+span*0.15;
  x=at=>minAt===maxAt?(left+width-right)/2:left+(at-minAt)/(maxAt-minAt)*(width-left-right);
  y=value=>height-bottom-(value-low)/(high-low)*(height-top-bottom);
  const svg=svgNode('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':'שווי תיק Spot ב־USDT לאורך היום. מדידות מ־'+clock(s.firstAt)+' עד '+clock(s.lastAt)});
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
  if(mode!=='live'||busy||(!force&&now()-lastAttempt<60000))return;
  const request=++generation;lastAttempt=now();busy=true;refresh.disabled=true;
  if(!data)status.textContent='טוען את מדידות שווי התיק…';
  try{const result=await read();if(request!==generation)return;if(!result?.ok||!Array.isArray(result.points)||!result.summary)throw Error('לא התקבלו מדידות תקינות.');data=result;render();}
  catch(error){if(request!==generation)return;clear();status.textContent=error.status===401?'נדרש חיבור מכשיר לצפייה בשווי התיק.':'לא ניתן לעדכן כעת את גרף השווי. נסה לרענן בעוד רגע.';}
  finally{if(request===generation){busy=false;refresh.disabled=false;}}
 }
 refresh.addEventListener('click',()=>load(true));range.addEventListener('input',()=>{selected=Number(range.value);selectionText();});clear();
 return {load,setContext(context){
  const next=context.unauthorized?'disconnected':context.mode;
  if(mode!==next){mode=next;generation++;busy=false;lastAttempt=-Infinity;clear();}
  refresh.hidden=mode!=='live';refresh.disabled=busy;note.hidden=mode!=='live';
  if(mode!=='live'){status.textContent=mode==='demo'?'גרף התיק האמיתי זמין במצב LIVE.':'חבר את המכשיר כדי לצפות בשווי התיק.';return;}
  if(context.visible!==false)load();
 },tick(){if(mode==='live'){if(data)render();if(!host.hidden)load();}}};
}
const host=document.getElementById('binanceEquityPanel');
if(host){
 const panel=createEquityPanel(host,{read:async()=>{
  const url=window.API_BASE+'/api/binance-equity-history';
  const response=await fetch(window.binanceReadUrl(url),{headers:window.binanceReadHeaders(url),cache:'no-store',signal:AbortSignal.timeout(15000)});
  const result=await response.json();if(!response.ok){const error=Error();error.status=response.status;throw error;}return result;
 }});
 const context=detail=>panel.setContext({...detail,visible:!host.hidden});
 window.addEventListener('levi:binance-dashboard',event=>context(event.detail));
 if(window.LEVI_DASHBOARD_SNAPSHOT)context(window.LEVI_DASHBOARD_SNAPSHOT);
 setInterval(()=>{if(!document.hidden)panel.tick();},15000);
 window.addEventListener('focus',()=>panel.tick());
}
