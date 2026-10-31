// Confirmed swing channel; display and passive study only.
(function(root){
 'use strict';
 function analyze(input,options={}){
  const base=root.LEVI_REGRESSION.analyze(input,options);
  if(!base.ready)return base;
  const bars=input.filter(b=>+b.openTime>=base.start&&+b.openTime<=base.end&&b.closed!==false).slice(-base.n);
  const lows=[],highs=[];
  for(let i=2;i<bars.length-2;i++){
   if([-2,-1,1,2].every(j=>+bars[i].low<+bars[i+j].low))lows.push({i,p:+bars[i].low});
   if([-2,-1,1,2].every(j=>+bars[i].high>+bars[i+j].high))highs.push({i,p:+bars[i].high});
  }
  const candidates=[];
  for(const [side,anchors,opposite] of [['low',lows,highs],['high',highs,lows]]){
   const b=anchors.at(-1),a=b&&anchors.slice(0,-1).findLast(p=>b.i-p.i>=3);
   if(!a||!opposite.some(p=>p.i>=a.i))continue;
   const slope=(b.p-a.p)/(b.i-a.i),edge=a.p-slope*a.i;
   const other=opposite.filter(p=>p.i>=a.i).map(p=>p.p-slope*p.i);
   const lowerIntercept=side==='low'?edge:Math.min(...other),upperIntercept=side==='high'?edge:Math.max(...other);
   if(upperIntercept<=lowerIntercept)continue;
   const width=(upperIntercept-lowerIntercept)/2,intercept=(upperIntercept+lowerIntercept)/2;
   const tolerance=Math.max(width*.05,base.lastClose*.0001);
   // Reject channels already broken by a closed candle since their first anchor.
   if(bars.some((p,i)=>i>=a.i&&(+p.close<lowerIntercept+slope*i-tolerance||+p.close>upperIntercept+slope*i+tolerance)))continue;
   const touches=(pivots,edge)=>pivots.filter(p=>p.i>=a.i&&Math.abs(p.p-(edge+slope*p.i))<=tolerance).length;
   const lowTouches=touches(lows,lowerIntercept),highTouches=touches(highs,upperIntercept),middle=intercept+slope*(base.n-1);
   candidates.push({...base,slope,intercept,width,middle,upper:middle+width,lower:middle-width,lowTouches,highTouches,anchorStart:base.start+a.i*base.duration,anchorEnd:base.start+b.i*base.duration,side,provisional:lowTouches<2||highTouches<2});
  }
  candidates.sort((a,b)=>b.anchorEnd-a.anchorEnd||Number(a.provisional)-Number(b.provisional)||a.width-b.width);
  return candidates[0]||{ready:false,reason:'NO_VALID_SWINGS'};
 }
 function describe(a){return !a?.ready?'תעלה מקבילה · אין מספיק נקודות קיצון מאושרות לתעלה תקפה':'תעלה מקבילה · כתום · '+a.lowTouches+' נגיעות תחתונות / '+a.highTouches+' עליונות · '+(a.provisional?'ראשונית — חסרה נגיעה שנייה באחד הגבולות':'לפחות שתי נגיעות בכל גבול')+' · קיצון מאושר אחרי שני נרות נוספים · המרכז הוא אמצע התעלה · הגעה לגבול הנגדי אינה מובטחת';}
 function draw(args){
  const {ctx,analysis:a,view,x,y,bounds}=args;if(!a?.ready)return;
  const points=view.map((b,i)=>({at:+b.openTime,i})).filter(b=>b.at>=a.anchorStart&&b.at<=a.end);if(points.length<2)return;
  const first=points[0],last=points.at(-1),p=root.LEVI_REGRESSION.levels(a,first.at),q=root.LEVI_REGRESSION.levels(a,last.at);
  ctx.save();ctx.beginPath();ctx.rect(bounds.left,bounds.top,bounds.right-bounds.left,bounds.bottom-bounds.top);ctx.clip();
  for(const key of ['upper','middle','lower']){ctx.strokeStyle='#ffb454';ctx.lineWidth=key==='middle'?1:2;ctx.setLineDash(key==='middle'?[2,5]:[10,4]);ctx.beginPath();ctx.moveTo(x(first.i),y(p[key]));ctx.lineTo(x(last.i),y(q[key]));ctx.stroke();}ctx.restore();
 }
 root.LEVI_PARALLEL=Object.freeze({analyze,describe,draw});
})(globalThis);
