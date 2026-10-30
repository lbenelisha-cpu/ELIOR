// Descriptive chart analysis only. No account access or trading decisions.
(function(root){
 'use strict';
 const durations={'1m':60000,'5m':300000,'30m':1800000,'1h':3600000,'5h':18000000,'1d':86400000};
 const valid=v=>v!==null&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v))&&Number(v)>0;
 function analyze(input,{interval='5m',period=100,deviations=2,now=Date.now()}={}){
  const duration=durations[interval],reject=reason=>({ready:false,reason,period});
  if(!duration||![50,100,200].includes(period)||![1,2,3].includes(deviations)||!Array.isArray(input))return reject('INVALID_INPUT');
  let bars=[];
  for(const b of input.slice(-600)){
   const at=Number(b.openTime),end=b.closeTime===undefined?at+duration:Number(b.closeTime);
   if(end>now||b.closed===false)continue;
   if(!Number.isFinite(at)||!Number.isFinite(end)||end<=at||!['open','high','low','close'].every(k=>valid(b[k]))||+b.high<Math.max(+b.open,+b.close)||+b.low>Math.min(+b.open,+b.close)){bars=[];continue;}
   if(bars.length&&at-bars.at(-1).at!==duration)bars=[];
   bars.push({at,close:+b.close});
  }
  bars=bars.slice(-period);if(bars.length<period)return {...reject('INSUFFICIENT_BARS'),available:bars.length};
  const n=bars.length,mx=(n-1)/2,my=bars.reduce((s,b)=>s+b.close,0)/n;
  let xx=0,xy=0,yy=0;for(let i=0;i<n;i++){const dx=i-mx,dy=bars[i].close-my;xx+=dx*dx;xy+=dx*dy;yy+=dy*dy;}
  const slope=xy/xx,intercept=my-slope*mx;
  const sse=bars.reduce((s,b,i)=>s+(b.close-intercept-slope*i)**2,0),sigma=Math.sqrt(Math.max(0,sse/n));
  const middle=intercept+slope*(n-1),width=deviations*sigma,upper=middle+width,lower=middle-width;
  if(![slope,intercept,sigma,upper,lower].every(Number.isFinite))return reject('INVALID_INPUT');
  const last=bars.at(-1),epsilon=Math.max(Math.abs(middle)*1e-12,Number.EPSILON);
  const location=last.close>upper+epsilon?'ABOVE':last.close<lower-epsilon?'BELOW':'INSIDE';
  return {ready:true,period,n,duration,deviations,start:bars[0].at,end:last.at,slope,intercept,sigma,width,middle,upper,lower,lastClose:last.close,location,r2:yy>epsilon*epsilon?Math.max(0,Math.min(1,1-sse/yy)):null,nextMiddle:intercept+slope*n};
 }
 function levels(a,at){const middle=a.intercept+a.slope*((at-a.start)/a.duration);return {middle,upper:middle+a.width,lower:middle-a.width};}
 function describe(a){
  if(!a?.ready)return a?.reason==='INSUFFICIENT_BARS'?'Regression Trend · נדרשים '+a.period+' נרות סגורים ורציפים; זמינים '+a.available:'Regression Trend · אין נתונים תקפים לחישוב';
  const fmt=n=>n.toLocaleString('en-US',{maximumSignificantDigits:7}),direction=Math.abs(a.slope)<=Math.abs(a.middle)*1e-12?'שטוחה':a.slope>0?'עולה':'יורדת';
  const location={ABOVE:'סגירת המחיר מעל הגבול העליון',BELOW:'סגירת המחיר מתחת לגבול התחתון',INSIDE:'סגירת המחיר בתוך התעלה'}[a.location];
  return 'Regression Trend · מגמה '+direction+' · '+a.n+' נרות בטווח המוצג · גבולות ±'+a.deviations+'σ · תחתון '+fmt(a.lower)+' | מרכז '+fmt(a.middle)+' | עליון '+fmt(a.upper)+' · '+location+' · R² '+(a.r2===null?'לא מוגדר במחיר קבוע':a.r2.toFixed(2))+' (מידת התאמה, לא סיכויי הצלחה) · אם השיפוע יימשך, מרכז התעלה בנר הבא: '+fmt(a.nextMiddle)+' · התעלה מתעדכנת עם הנרות; יציאה ממנה היא חריגה למעקב, לא הוראת קנייה או מכירה. הגבולות אינם רווח סמך או תחזית מובטחת.';
 }
 function draw({ctx,analysis:a,view,x,y,bounds}){
  if(!a?.ready||!view.length)return;
  const indices=view.map((b,i)=>({at:Number(b.openTime),i})).filter(b=>b.at>=a.start&&b.at<=a.end);if(indices.length<2)return;
  const first=indices[0],last=indices.at(-1),p=levels(a,first.at),q=levels(a,last.at),x1=x(first.i),x2=x(last.i);
  ctx.save();ctx.beginPath();ctx.rect(bounds.left,bounds.top,bounds.right-bounds.left,bounds.bottom-bounds.top);ctx.clip();ctx.fillStyle='rgba(75,170,255,.09)';ctx.beginPath();ctx.moveTo(x1,y(p.upper));ctx.lineTo(x2,y(q.upper));ctx.lineTo(x2,y(q.lower));ctx.lineTo(x1,y(p.lower));ctx.closePath();ctx.fill();
  for(const key of ['upper','middle','lower']){ctx.strokeStyle=key==='middle'?'#67bcff':'#b7a3ff';ctx.lineWidth=key==='middle'?2.5:1.5;ctx.setLineDash(key==='middle'?[6,3]:[]);ctx.beginPath();ctx.moveTo(x1,y(p[key]));ctx.lineTo(x2,y(q[key]));ctx.stroke();}
  ctx.restore();
 }
 root.LEVI_REGRESSION=Object.freeze({analyze,levels,describe,draw});
})(globalThis);
