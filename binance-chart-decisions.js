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
  const setup=row.setup||{};
  const parts=[label+' · '+new Date(row.at).toLocaleString('he-IL')+' · '+String(row.mode||currentMode).toUpperCase(),
   'מחיר: '+(Number(row.price)>0?fmt(row.price,6):'לא זמין'),
   'סיבה: '+decisionReasonLabel(row.buyReason||row.reason||row.analysisReason),
   'החלטה: '+decisionLabel(row.decision||row.type||'HOLD')+' · '+(row.checks||1)+' בדיקות'];
  if(row.firstAt&&row.firstAt!==row.at)parts.push('הבדיקה הראשונה בקבוצה: '+new Date(row.firstAt).toLocaleString('he-IL'));
  if(row.analysisReason&&row.analysisReason!==row.buyReason)parts.push('תוצאת הניתוח לפני חסימת המסחר: '+decisionReasonLabel(row.analysisReason));
  for(const [key,label] of [['initialPeak','שיא ראשוני'],['firstLow','שפל ראשון'],['springLow','שפל שני']]){
   const value=setup[key]?.price;if(Number(value)>0)parts.push(label+': '+fmt(value,6));
  }
  if(setup.phase)parts.push('שלב: '+decisionReasonLabel(setup.phase));
  if(Number(row.targetPrice)>0)parts.push('יעד מחיר: '+fmt(row.targetPrice,6));
  if(kind==='signal'){
   if(interval!=='1d')parts.push('למעקב אחרי האות בחר נרות 1D.');
   else for(const days of [1,7]){
    const result=chartSignalReturn(row,candles,days);
    parts.push('שינוי מחיר אחרי '+days+' ימים: '+(result===null?'ממתין / נתונים לא זמינים':(result>=0?'+':'')+fmt(result,2)+'%'));
   }
   parts.push('מעקב לפי הסגירה היומית הראשונה לאחר פרק הזמן; אינו רווח ממומש ואינו כולל עמלות.');
  }
  article.textContent=parts.join('\n');panel.append(article);
 }
}
function renderChartDecisionMarkers(ctx,view,allCandles,rows,step,left,top,interval){
 const colors={signal:'#2bd88a',wait:'#ffbd59',error:'#ff6172',fill:'#8bbdff'};
 const kinds=['signal','wait','error','fill'];
 const groups=groupChartDecisions(view,rows);
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
  button.textContent=new Date(view[group.index].openTime).toLocaleDateString('he-IL')+' · '+labels[group.kind]+' · '+group.checks;
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
