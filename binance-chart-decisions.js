/* Read-only chart annotations. No trading requests. */
function chartDecisionKind(row){
 if(row.type==='BUY'||row.type==='SELL')return 'fill';
 if(row.analysisError||row.execution==='ERROR'||row.decision==='WAIT_DATA')return 'error';
 return row.analysisSignal===true||row.entryConfirmed===true?'signal':'wait';
}
function groupChartDecisions(candles,rows){
 const groups=new Map();
 for(const row of rows){
  const time=Date.parse(row.at);
  const index=candles.findIndex(c=>time>=Number(c.openTime)&&time<=Number(c.closeTime));
  if(index<0)continue;
  const kind=chartDecisionKind(row),key=index+':'+kind;
  if(!groups.has(key))groups.set(key,{index,kind,rows:[],checks:0});
  const group=groups.get(key);group.rows.push(row);group.checks+=row.checks||1;
 }
 return [...groups.values()];
}
function chartSignalReturn(row,candles,days,now=Date.now()){
 const price=Number(row.price),after=Date.parse(row.at)+days*86400000;
 if(!(price>0)||!Number.isFinite(after)||now<after)return null;
 const candle=candles.find(c=>Number(c.closeTime)>=after&&Number(c.closeTime)<=now&&Number(c.closeTime)<after+86400000+1000);
 return candle?(Number(candle.close)/price-1)*100:null;
}
function chartDecisionDetails(group,candles,interval){
 const panel=document.querySelector('#chartDecisionDetails');
 if(!panel)return;
 panel.replaceChildren();
 const title=document.createElement('strong');
 title.textContent='פירוט '+group.checks+' בדיקות / פעולות על הנר';panel.append(title);
 for(const row of [...group.rows].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))){
  const article=document.createElement('div');article.className='chart-analysis-row';
  const kind=chartDecisionKind(row);
  const label=kind==='fill'?(row.type==='BUY'?'קנייה בפועל':'מכירה בפועל'):kind==='error'?'שגיאת ניתוח':kind==='signal'?'אות כניסה זוהה':'תנאי הכניסה לא הושלמו';
  const setup=row.setup||row.wyckoffTrade?.setup||{};
  const parts=[label+' · '+new Date(row.at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'})+' · '+String(row.mode||currentMode).toUpperCase(),
   'מחיר: '+(Number(row.price)>0?fmt(row.price,12):'לא זמין'),
   'סיבה: '+decisionReasonLabel(row.buyReason||row.reason||row.analysisReason),
   'החלטה: '+decisionLabel(row.decision||row.type||'HOLD')+' · '+(row.checks||1)+' בדיקות'];
  if(row.firstAt&&row.firstAt!==row.at)parts.push('הבדיקה הראשונה בקבוצה: '+new Date(row.firstAt).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}));
  if(row.analysisReason&&row.analysisReason!==row.buyReason)parts.push('תוצאת הניתוח לפני חסימת המסחר: '+decisionReasonLabel(row.analysisReason));
  for(const [key,label] of [['initialPeak','שיא ראשוני'],['firstLow','שפל ראשון'],['springLow','שפל שני']]){
   const value=setup[key]?.price;if(Number(value)>0)parts.push(label+': '+fmt(value,12));
  }
  if(setup.phase)parts.push('שלב: '+decisionReasonLabel(setup.phase));
  if(Number(row.targetPrice)>0)parts.push('יעד מחיר: '+fmt(row.targetPrice,12));
  if(kind==='signal'){
   if(!['1d','5m'].includes(interval))parts.push('למעקב אחרי האות בחר נרות 5M או 1D.');
   else for(const days of [1,7]){
    const result=chartSignalReturn(row,candles,days);
    parts.push('שינוי מחיר אחרי '+days+' ימים: '+(result===null?'ממתין / נתונים לא זמינים':(result>=0?'+':'')+fmt(result,2)+'%'));
   }
   parts.push('מעקב לפי סגירת הנר הראשונה לאחר פרק הזמן; אינו רווח ממומש ואינו כולל עמלות.');
  }
  article.textContent=parts.join('\n');panel.append(article);
 }
}
function renderChartDecisionMarkers(ctx,view,allCandles,rows,step,left,top,interval){
 const colors={signal:'#2bd88a',wait:'#ffbd59',error:'#ff6172',fill:'#8bbdff'};
 const kinds=['signal','wait','error','fill'];
 const rawGroups=groupChartDecisions(view,rows),groups=[];
 for(const group of rawGroups.sort((a,b)=>a.index-b.index)){
  const previous=[...groups].reverse().find(g=>g.kind===group.kind);
  if(['wait','error'].includes(group.kind)&&previous&&(group.index-previous.index)*step<28){previous.rows.push(...group.rows);previous.checks+=group.checks;}else groups.push(group);
 }
 const buttons=document.querySelector('#chartDecisionMarkers');
 if(!buttons)return;
 buttons.replaceChildren();
 const hits=[];
 for(const group of groups){
  const x=left+step*(group.index+.5),y=top+12+kinds.indexOf(group.kind)*17;
  ctx.fillStyle=colors[group.kind];ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();
  hits.push({...group,x,y});
  const button=document.createElement('button');button.type='button';button.className='analysis-marker '+group.kind;
  const labels={signal:'אות אושר',wait:'ממתין',error:'שגיאה',fill:'עסקה בוצעה'};
  button.textContent=new Date(view[group.index].openTime).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'})+' · '+labels[group.kind]+' · '+group.checks;
  button.onclick=()=>chartDecisionDetails(group,allCandles,interval);buttons.append(button);
 }
 if(!groups.length)buttons.textContent='אין בדיקות שמורות בטווח הנרות המוצג. ההיסטוריה הישנה אינה משוחזרת.';
 const canvas=document.querySelector('#priceChart');
 canvas.onclick=event=>{
  const rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
  const nearest=hits.filter(h=>Math.hypot(h.x-x,h.y-y)<=16).sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y))[0];
  if(nearest)chartDecisionDetails(nearest,allCandles,interval);
 };
}

function latestWyckoffSetup(rows){
 const candidates=rows.filter(r=>(r.analysisSignal===true||r.entryConfirmed===true||r.type==='BUY')&&(r.setup?.springLow||r.wyckoffTrade?.setup?.springLow)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
 return candidates[0]?.setup||candidates[0]?.wyckoffTrade?.setup||null;
}
function renderWyckoffPivots(view,rows,step,left,y,digits){
 const root=document.querySelector('#wyckoffPivots');if(!root)return;root.replaceChildren();
 const agent=(currentAgentData?.agents||[]).find(a=>a.symbol===selectedSymbol);
 const tradeSetup=agent?.position==='LONG'?agent.strategy?.setup:null;
 const setup=tradeSetup?.springLow?tradeSetup:latestWyckoffSetup(rows);if(!setup)return;
 const active=agent?.position==='LONG'&&!!tradeSetup?.springLow&&setup===tradeSetup;
 root.dataset.active=String(active);
 const status=document.createElement('span');status.className='wyckoff-setup-status';
 const at=Number(setup.signalTime||setup.confirmation?.time);
 status.textContent=(active?'מסחר פעיל · תבנית הקנייה':'תבנית היסטורית — אין מסחר פעיל בתבנית')+(at?' · '+new Date(at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}):'');
 root.append(status);
 const width=root.clientWidth,height=root.clientHeight;
 const points=[['initialPeak','שיא ראשוני'],['firstLow','שפל ראשוני'],['rallyHigh','שיא התאוששות'],['secondaryTest','בדיקה חוזרת'],['springLow','Spring'],['confirmation','אישור כניסה']];
 const colors={initialPeak:'#ffb454',firstLow:'#49cfff',rallyHigh:'#c59aff',secondaryTest:'#ff86b8',springLow:'#52e0a4',confirmation:'#fff08a'};
 for(const [key,label] of points){
  const p=setup[key];if(!p||!(Number(p.price)>0))continue;
  const index=view.findIndex(c=>Number(p.time)>=Number(c.openTime)&&Number(p.time)<=Number(c.closeTime));if(index<0)continue;
  const button=document.createElement('button');button.type='button';button.className='wyckoff-pivot';
  button.style.setProperty('--pivot-color',colors[key]);button.dataset.pivot=key;
  const anchorX=left+step*(index+.5),anchorY=y(Number(p.price));
  const slot=points.findIndex(point=>point[0]===key);
  const labelX=key==='confirmation'?anchorX:12+(width-24)*(slot+.5)/5;
  const labelY=key==='confirmation'?anchorY:height-28;
  if(key==='confirmation')button.classList.add('confirmation-pivot');
  else button.style.width=Math.max(36,(width-24)/5-10)+'px';
  const connector=document.createElement('span');connector.className='wyckoff-connector';
  connector.style.setProperty('--pivot-color',colors[key]);
  connector.style.left=anchorX+'px';connector.style.top=anchorY+'px';
  connector.style.width=Math.hypot(labelX-anchorX,labelY-anchorY)+'px';
  connector.style.transform='rotate('+Math.atan2(labelY-anchorY,labelX-anchorX)+'rad)';root.append(connector);
  const dot=document.createElement('span');dot.className='wyckoff-anchor';dot.dataset.pivot=key;dot.style.setProperty('--pivot-color',colors[key]);dot.style.left=anchorX+'px';dot.style.top=anchorY+'px';root.append(dot);
  button.style.left=labelX+'px';button.style.top=labelY+'px';
  button.textContent=key==='confirmation'?'✓':label;button.setAttribute('aria-label',label);button.title=label+' · '+fmt(p.price,digits)+' · '+new Date(p.time).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'});
  button.onclick=()=>{const panel=document.querySelector('#chartDecisionDetails');if(panel)panel.textContent=button.title+' · '+({initialPeak:'השיא שממנו החלה התבנית',firstLow:'רמת התמיכה שנקבעה בתבנית',rallyHigh:'שיא ההתאוששות לאחר השפל',secondaryTest:'בדיקה חוזרת של התמיכה לפני הדשדוש',springLow:'ירידה מתחת לשפל הראשוני לאחר הדשדוש',confirmation:setup.confirmation?.live?'המחיר החי חצה את השפל הראשוני לאחר ה־Spring, ללא המתנה לסגירת נר':'נר סגור שחזר מעל השפל הראשוני לאחר ה־Spring'}[key]);};root.append(button);
 }
}
