// Display-only analysis. This module never submits orders or changes bot settings.
(function(root){
 'use strict';
 const durations={'1m':60000,'5m':300000,'5min':300000,'10min':600000,'15min':900000,'30m':1800000,'1h':3600000,'5h':18000000,'1d':86400000};
 const stamp=b=>b.openTime!==undefined?Number(b.openTime):Date.parse(b.date);
 const number=v=>v!==null&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v));
 function detect(input,{interval='5m',now=Date.now()}={}){
  const duration=durations[interval];if(!duration||!Array.isArray(input))return null;
  // Keep source order; malformed, duplicated or missing intraday bars reset evidence.
  let bars=[],zone=null,previous=null;
  for(const raw of input.slice(-600)){
   const at=stamp(raw),end=raw.closeTime!==undefined?Number(raw.closeTime):at+duration;
   if(!Number.isFinite(at)||!Number.isFinite(end)||end<=at||end>now||raw.closed===false)continue;
   if(!['open','high','low','close'].every(k=>number(raw[k])&&Number(raw[k])>0)||Number(raw.high)<Math.max(Number(raw.open),Number(raw.close))||Number(raw.low)>Math.min(Number(raw.open),Number(raw.close))){bars=[];zone=null;previous=null;continue;}
   const b={at,end,open:+raw.open,high:+raw.high,low:+raw.low,close:+raw.close};
   if(previous!==null&&at-previous!==duration){bars=[];zone=null;}previous=at;
   if(zone&&(bars.length-zone.createdIndex>40||zone.breakoutAt&&bars.length-zone.breakoutIndex>20))zone=null;
   if(!zone&&bars.length>=20){
    const window=bars.slice(-20),upper=Math.max(...window.map(v=>v.high)),lower=upper*.997;
    const touches=window.map((v,i)=>v.high>=lower?i:-1).filter(i=>i>=0),first=touches[0],last=touches.at(-1);
    if(last-first>=3&&window.slice(first+1,last).some(v=>v.low<lower*.997)){
     zone={start:window[first].at,end:window.at(-1).end,upper,lower,touches:touches.length,createdIndex:bars.length,status:'RESISTANCE',breakoutAt:null};
    }
   }
   if(zone){
    zone.end=end;
    if(!zone.breakoutAt&&b.close>zone.upper){zone.breakoutAt=at;zone.breakoutIndex=bars.length;zone.status='BREAKOUT';}
    else if(zone.breakoutAt&&b.close<zone.lower)zone.status='FAILED_BREAKOUT';
    // A failed breakout stays failed until this zone expires; no relabelled old signal.
   }
   bars.push(b);
  }
  if(!zone)return null;
  const {createdIndex,breakoutIndex,...result}=zone;return result;
 }
 const label=z=>({RESISTANCE:'אזור התנגדות · טרם אושרה פריצה',BREAKOUT:'פריצה מעל ההתנגדות · אושרה בנר סגור',FAILED_BREAKOUT:'פריצה שנכשלה · סגירה מתחת לאזור'}[z.status]);
 const color=z=>({RESISTANCE:'#ffc66d',BREAKOUT:'#48deb0',FAILED_BREAKOUT:'#ff8095'}[z.status]);
 function geometry(zone,view,x,y,bounds){
  if(!zone||!view.length)return null;
  const first=stamp(view[0]),last=stamp(view.at(-1)),step=view.length>1?x(1)-x(0):bounds.right-bounds.left;
  if(zone.end<=first||zone.start>last)return null;
  let start=view.findIndex(b=>stamp(b)>=zone.start);if(start<0)start=0;
  let end=view.findIndex(b=>stamp(b)>=zone.end);if(end<0)end=view.length;
  const top=Math.max(bounds.top,y(zone.upper)),bottom=Math.min(bounds.bottom,y(zone.lower));
  if(bottom<top)return null;
  const left=Math.max(bounds.left,x(start)-step/2),right=Math.min(bounds.right,x(Math.max(start,end-1))+step/2);
  const breakout=zone.breakoutAt===null?-1:view.findIndex(b=>stamp(b)===zone.breakoutAt);
  return {left,top,width:Math.max(1,right-left),height:Math.max(2,bottom-top),breakoutX:breakout<0?null:x(breakout),breakoutY:Math.max(bounds.top,Math.min(bounds.bottom,y(zone.upper)))};
 }
 function describe(zone,interval){return (zone?label(zone)+' · '+zone.lower.toLocaleString('en-US',{maximumSignificantDigits:7})+'–'+zone.upper.toLocaleString('en-US',{maximumSignificantDigits:7}):'לא זוהה אזור התנגדות חוזר בנרות הסגורים')+' · '+interval+' · ניתוח תצוגה בלבד; אינו אישור קנייה של הבוט';}
 function drawCanvas({ctx,zone,view,x,y,bounds}){
  const g=geometry(zone,view,x,y,bounds);if(!g)return;
  ctx.save();ctx.beginPath();ctx.rect(bounds.left,bounds.top,bounds.right-bounds.left,bounds.bottom-bounds.top);ctx.clip();
  ctx.fillStyle=color(zone);ctx.globalAlpha=.12;ctx.fillRect(g.left,g.top,g.width,g.height);ctx.globalAlpha=1;ctx.strokeStyle=color(zone);ctx.lineWidth=2;ctx.setLineDash(zone.status==='RESISTANCE'?[5,3]:[]);ctx.strokeRect(g.left,g.top,g.width,g.height);
  if(g.breakoutX!==null){ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(g.breakoutX,bounds.top);ctx.lineTo(g.breakoutX,bounds.bottom);ctx.stroke();}
  ctx.restore();
 }
 function drawSvg({svg,zone,view,x,y,bounds,document:doc=root.document}){
  const g=geometry(zone,view,x,y,bounds);if(!g)return;
  const make=(tag,attrs)=>{const e=doc.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);return e;};
  const group=make('g',{'data-resistance-pattern':zone.status,'pointer-events':'none','aria-label':label(zone)});
  group.append(make('rect',{x:g.left,y:g.top,width:g.width,height:g.height,fill:color(zone),'fill-opacity':.12,stroke:color(zone),'stroke-width':2,'stroke-dasharray':zone.status==='RESISTANCE'?'5 3':'none'}));
  if(g.breakoutX!==null)group.append(make('line',{x1:g.breakoutX,x2:g.breakoutX,y1:bounds.top,y2:bounds.bottom,stroke:color(zone),'stroke-dasharray':'3 3'}));
  svg.append(group);
 }
 root.LEVI_RESISTANCE=Object.freeze({detect,geometry,describe,drawCanvas,drawSvg});
})(globalThis);
