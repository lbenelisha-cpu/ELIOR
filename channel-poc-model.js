// Shared, deterministic geometry for the server and chart. No account or order access.
(function(root){
 'use strict';
 const STEP=300000,VERSION='CHANNEL_POC_RETEST_V1',REPORT='CHANNEL_POC_CONDITIONS_V1';
 const consolidationPolicy=Object.freeze({version:'CHANNEL_INITIAL_CONSOLIDATION_V2',minBars:3,maxBars:8,maxRangeFraction:.35,maxDriftFraction:.5,lowerZone:1/3,upperZone:2/3,selection:'CONTAINS_FIRST_CHANNEL_ANCHOR',middle:'ALLOW_BOTH'});
 const positive=n=>Number.isFinite(n)&&n>0;
 function profile(input,bins=32){
  if(!Array.isArray(input)||!input.length||!Number.isInteger(bins)||bins<2||bins>128)return null;
  if(input.some(b=>!['low','high','volume'].every(k=>Number.isFinite(b[k]))||b.low<=0||b.high<b.low||b.volume<0))return null;
  const low=Math.min(...input.map(b=>b.low)),high=Math.max(...input.map(b=>b.high)),step=(high-low)/bins;
  if(!(step>0))return null;
  const volumes=Array(bins).fill(0);
  for(const b of input){
   if(b.high===b.low){volumes[Math.min(bins-1,Math.floor((b.low-low)/step))]+=b.volume;continue;}
   for(let i=0;i<bins;i++)volumes[i]+=b.volume*Math.max(0,Math.min(low+(i+1)*step,b.high)-Math.max(low+i*step,b.low))/(b.high-b.low);
  }
  const max=Math.max(...volumes);if(!(max>0))return null;
  const index=volumes.indexOf(max);
  return {method:'OHLC_UNIFORM_ESTIMATE',estimated:true,bins,low,high,step,volumes,max,index,poc:low+(index+.5)*step,totalVolume:volumes.reduce((a,b)=>a+b,0)};
 }
 function initialRange(history,channel,side){
  const p=consolidationPolicy,first=Math.round((channel.anchorStart-channel.start)/STEP),width=2*channel.width;
  // The range must contain the channel's first anchor, not any later sideways pause.
  for(let count=p.maxBars;count>=p.minBars;count--)for(let start=Math.max(0,first-count+1);start<=first;start++){
   const end=start+count;if(end>history.length||end<=first)continue;
   const bars=history.slice(start,end);
   if(bars.some((b,i)=>i&&b.openTime!==bars[i-1].closeTime))continue;
   const low=Math.min(...bars.map(b=>b.low)),high=Math.max(...bars.map(b=>b.high)),range=high-low;
   if(!(range>0)||range/width>p.maxRangeFraction)continue;
   const driftFraction=Math.abs(bars.at(-1).close-bars[0].close)/range;
   if(driftFraction>p.maxDriftFraction)continue;
   const locations=bars.map((b,i)=>((b.high+b.low)/2-(channel.intercept+channel.slope*(start+i)-channel.width))/width);
   if(locations.some(v=>v<0||v>1))continue;
   const location=locations.reduce((s,v)=>s+v,0)/count,zone=location<=p.lowerZone?'LOWER':location>=p.upperZone?'UPPER':'MIDDLE';
   const passed=side==='LONG'?zone!=='UPPER':zone!=='LOWER';
   return {version:p.version,side,passed,reason:passed?'INITIAL_CONSOLIDATION_READY':'CHANNEL_CONSOLIDATION_SIDE_BLOCK',zone,location,low,high,bars:count,startAt:bars[0].openTime,endAt:bars.at(-1).closeTime,anchorAt:history[first].openTime,rangeFraction:range/width,driftFraction};
  }
  return {version:p.version,side,passed:false,reason:'WAIT_INITIAL_CHANNEL_CONSOLIDATION'};
 }
 function geometry(history){
  if(history.length!==50||!root.LEVI_PARALLEL)return null;
  const mapped=history.map((b,i)=>({...b,openTime:STEP*(i+1),closeTime:STEP*(i+2)}));
  const c=root.LEVI_PARALLEL.analyze(mapped,{period:50,interval:'5m',now:52*STEP,deviations:2,requireConfirmed:true});
  return c.ready&&!c.provisional?c:null;
 }
 function freeze(history,b,c,side){
  const first=Math.round((c.anchorStart-c.start)/STEP),basis=history.slice(first);
  const consolidation=initialRange(history,c,side),key=side==='LONG'?'low':'high';
  let ai=first;for(let i=first+1;i<history.length;i++)if(side==='LONG'?history[i].low<history[ai].low:history[i].high>history[ai].high)ai=i;
  const selected=[...history.slice(ai),b],vp=profile(selected),level=c.intercept+c.slope*50+(side==='LONG'?c.width:-c.width);
  return {version:VERSION,side,breakoutAt:b.openTime,frozenAt:b.closeTime,anchorA:{time:history[ai].openTime,price:history[ai][key]},anchorB:{time:b.openTime,price:b[side==='LONG'?'high':'low']},profile:vp,consolidation,
   channel:{startAt:history[0].openTime,anchorAt:basis[0].openTime,endAt:b.openTime,barTimes:history.map(b=>b.openTime),intercept:c.intercept,slope:c.slope,width:c.width,lowTouches:c.lowTouches,highTouches:c.highTouches,level},
   id:['poc',side,history[first].openTime,history[Math.round((c.anchorEnd-c.start)/STEP)].openTime,b.openTime].join(':')};
 }
 function analyze({bars=[],side,price,liveBar,now=Date.now()}){
  if(!['LONG','SHORT'].includes(side))throw Error('INVALID_POC_SIDE');
  const closed=bars.filter(b=>b.closed!==false&&b.closeTime<=now),states={channel:'unknown',break:'unknown',poc:'unknown',range:'unknown'};
  let model=null;
  // Rebuild only from information already available at each historical candle.
  // No regression direction, volume multiplier, liquidity floor, target or pattern-age gate.
  for(let i=50;i<closed.length;i++){
   const history=closed.slice(i-50,i),b=closed[i],c=geometry(history);
   if(!c)continue;
   const upper=c.intercept+c.slope*50+c.width,lower=c.intercept+c.slope*50-c.width;
   const brokeUp=history.at(-1).close<=upper-c.slope&&b.high>upper;
   const brokeDown=history.at(-1).close>=lower-c.slope&&b.low<lower;
   if(brokeUp||brokeDown)model=brokeUp!==brokeDown&&(side==='LONG'?brokeUp:brokeDown)?freeze(history,b,c,side):null;
  }
  let reason;
  if(model){
   states.channel='passed';states.break='passed';states.range=model.consolidation.passed?'passed':'waiting';
   const pc=model.profile?.poc,previous=closed.at(-1),outside=positive(pc)&&(side==='LONG'?previous.close>pc:previous.close<pc);
   // Touch during the current return, not an old wick followed by a bounce.
   const touched=outside&&liveBar?.openTime>=model.frozenAt&&(side==='LONG'?price<=pc&&liveBar.low<=pc:price>=pc&&liveBar.high>=pc);
   states.poc=!model.profile?'unknown':touched?'passed':'waiting';
   reason=!model.consolidation.passed?model.consolidation.reason:!model.profile?'WAIT_POC_VOLUME_DATA':!touched?'WAIT_POC_RETEST':'CHANNEL_POC_READY';
  }else{
   const h=closed.slice(-50),c=geometry(h);
   states.channel=c?'passed':'waiting';
   if(c){const range=initialRange(h,c,side);states.range=range.passed?'passed':'waiting';states.break='waiting';reason=range.passed?'WAIT_POC_CHANNEL_BREAKOUT':range.reason;}
   else reason='WAIT_CHANNEL_TWO_TOUCHES';
  }
  const conditions={version:REPORT,side,at:now,expiresAt:(Math.floor(now/STEP)+1)*STEP,rows:Object.entries(states).map(([id,state])=>({id,state})),model,chart:model?{interval:'5m',bars:[...closed.slice(-79),...(liveBar?[liveBar]:[])].map(({openTime,closeTime,open,high,low,close,volume,closed})=>({openTime,closeTime,open,high,low,close,volume,closed})),price,at:now}:null};
  return {ready:Object.values(states).every(s=>s==='passed'),reason,model,conditions};
 }
 root.LEVI_CHANNEL_POC=Object.freeze({VERSION,REPORT,STEP,consolidationPolicy,profile,initialRange,geometry,freeze,analyze});
})(globalThis);
