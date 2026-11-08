// Shared, deterministic geometry for the server and chart. No account or order access.
(function(root){
 'use strict';
 const STEP=300000,VERSION='CHANNEL_POC_RETEST_V2',REPORT='CHANNEL_POC_CONDITIONS_V1';
 const ANCHOR_POLICY='RECENT_WAVE_POC_V2';
 const consolidationPolicy=Object.freeze({version:'CHANNEL_INITIAL_CONSOLIDATION_V2',minBars:3,maxBars:8,maxRangeFraction:.35,maxDriftFraction:.5,lowerZone:1/3,upperZone:2/3,selection:'CONTAINS_FIRST_CHANNEL_ANCHOR',middle:'ALLOW_BOTH'});
 const positive=n=>Number.isFinite(n)&&n>0;
 function profile(input,bins=128){
  if(!Array.isArray(input)||!input.length||!Number.isInteger(bins)||bins<2||bins>128)return null;
  if(input.some(b=>!['low','high','volume'].every(k=>Number.isFinite(b[k]))||b.low<=0||b.high<b.low||b.volume<0))return null;
  const low=Math.min(...input.map(b=>b.low)),high=Math.max(...input.map(b=>b.high)),step=(high-low)/bins;
  if(!(step>0))return null;
  const volumes=Array(bins).fill(0),priceMass=Array(bins).fill(0);
  for(const b of input){
   if(b.high===b.low){const i=Math.min(bins-1,Math.floor((b.low-low)/step));volumes[i]+=b.volume;priceMass[i]+=b.volume*b.low;continue;}
   for(let i=0;i<bins;i++){const lo=Math.max(low+i*step,b.low),hi=Math.min(low+(i+1)*step,b.high),overlap=Math.max(0,hi-lo),allocated=b.volume*overlap/(b.high-b.low);volumes[i]+=allocated;priceMass[i]+=allocated*(lo+hi)/2;}
  }
  const max=Math.max(...volumes);if(!(max>0))return null;
  const index=volumes.indexOf(max);
  return {method:'OHLC_RANGE_WEIGHTED_ESTIMATE',estimated:true,bins,low,high,step,volumes,max,index,poc:volumes[index]>0?priceMass[index]/volumes[index]:low+(index+.5)*step,totalVolume:volumes.reduce((a,b)=>a+b,0)};
 }
 function initialRange(history,channel,side,after=0){
  const p=consolidationPolicy,freshStart=after>0?history.findIndex(b=>b.openTime>after):0;
  if(freshStart<0)return {version:p.version,side,passed:false,reason:'WAIT_INITIAL_CHANNEL_CONSOLIDATION'};
  const first=Math.max(freshStart,Math.round((channel.anchorStart-channel.start)/STEP)),width=2*channel.width;
  // Initially use the channel anchor. After a close, require fresh range evidence
  // from the beginning of the new lifecycle within the retained channel.
  for(let count=p.maxBars;count>=p.minBars;count--)for(let start=Math.max(freshStart,first-count+1);start<=first;start++){
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
 function makeWave(bars,ref,side,breakIndex,startIndex,after=0){
  const {history,c,start}=ref,b=bars[breakIndex],key=side==='LONG'?'low':'high';
  const first=start+Math.round((c.anchorStart-c.start)/STEP),begin=Math.max(start,startIndex??first);
  if(begin>=breakIndex)return null;
  let ai=begin;
  // A belongs to the latest pullback. Equal extremes prefer the recent candle.
  for(let j=begin+1;j<breakIndex;j++)if(side==='LONG'?bars[j].low<=bars[ai].low:bars[j].high>=bars[ai].high)ai=j;
  const level=c.intercept+c.slope*(breakIndex-start)+(side==='LONG'?c.width:-c.width);
  const model={version:VERSION,anchorPolicy:ANCHOR_POLICY,side,breakoutAt:b.openTime,frozenAt:b.closeTime,
   anchorA:{time:bars[ai].openTime,price:bars[ai][key]},anchorB:{time:b.openTime,price:b[side==='LONG'?'high':'low']},profile:profile(bars.slice(ai,breakIndex+1)),consolidation:initialRange(history,c,side,after),
   channel:{startAt:history[0].openTime,anchorAt:bars[first].openTime,endAt:b.openTime,barTimes:bars.slice(start,breakIndex).map(row=>row.openTime),intercept:c.intercept,slope:c.slope,width:c.width,lowTouches:c.lowTouches,highTouches:c.highTouches,level},
   id:['poc-wave-v2',side,bars[ai].openTime,b.openTime].join(':')};
  return {model,aIndex:ai,bIndex:breakIndex,returnIndex:null};
 }
 function extendWave(wave,bars,index){
  const m=wave.model,b=bars[index],long=m.side==='LONG',prior=bars[index-1];
  if(wave.returnIndex!==null)return;
  const better=long?b.high>m.anchorB.price:b.low<m.anchorB.price;
  if(better){
   wave.bIndex=index;m.anchorB={time:b.openTime,price:long?b.high:b.low};
   m.frozenAt=b.closeTime;m.profile=profile(bars.slice(wave.aIndex,index+1));
  }
  // Once a completed return has occurred, retain this wave's B. A later break
  // starts a new wave from the intervening pullback, not the older channel low.
  const pc=m.profile?.poc;
  if(index>wave.bIndex&&positive(pc)&&(long?prior.close>pc&&b.low<=pc:prior.close<pc&&b.high>=pc))wave.returnIndex=index;
 }
 function freeze(history,b,c,side){return makeWave([...history,b],{history,c,start:0},side,history.length)?.model||null;}
 // Cache only deterministic closed-candle replay. Live prices, current candles,
 // freshness checks and entry decisions are evaluated on every call.
 const replays=new Map(),replayFields=['openTime','closeTime','open','high','low','close','volume'];
 let replayChars=0,replayEngine=null;
 function replay(closed,entryAfter){
  if(replayEngine!==root.LEVI_PARALLEL){replays.clear();replayChars=0;replayEngine=root.LEVI_PARALLEL;}
  const key=closed.length<=10000&&closed.every(b=>replayFields.every(k=>Number.isFinite(b[k])))?JSON.stringify([entryAfter,closed.map(b=>replayFields.map(k=>b[k]))]):null;
  if(key!==null&&replays.has(key)){
   const cached=replays.get(key);replays.delete(key);replays.set(key,cached);
   return structuredClone(cached);
  }
  const result=replayClosed(closed,entryAfter);
  if(key!==null&&key.length<=1000000){
   while(replays.size>=128||replayChars+key.length>32000000){const oldest=replays.keys().next().value;replayChars-=oldest.length;replays.delete(oldest);}
   replays.set(key,structuredClone(result));replayChars+=key.length;
  }
  return result;
 }
 function replayClosed(closed,entryAfter){
  const firstFresh=entryAfter>0?closed.findIndex(b=>b.openTime>entryAfter):0;
  if(firstFresh<0)return null;
  let wave=null,reference=null;
  // Replay forward only. A valid channel may remain the reference while its
  // breakout/return unfolds; no future candle identifies the wave's peak.
  for(let i=Math.max(50,firstFresh);i<closed.length;i++){
   const history=closed.slice(i-50,i),b=closed[i],c=geometry(history);
   if(c)reference={history,c,start:i-50};
   if(wave)extendWave(wave,closed,i);
   if(!reference)continue;
   const ref=reference,offset=i-ref.start,upper=ref.c.intercept+ref.c.slope*offset+ref.c.width,lower=ref.c.intercept+ref.c.slope*offset-ref.c.width;
   const brokeUp=closed[i-1].close<=upper-ref.c.slope&&b.high>upper;
   const brokeDown=closed[i-1].close>=lower-ref.c.slope&&b.low<lower;
   if(brokeUp&&brokeDown){wave=null;reference=null;continue;}
   if(!brokeUp&&!brokeDown)continue;
   const direction=brokeUp?'LONG':'SHORT';
   if(wave&&wave.model.side===direction&&wave.returnIndex===null)continue;
   const start=wave?(wave.model.side===direction?wave.returnIndex:wave.bIndex):null;
   if(start!==null&&start>=i)continue;
   // Rebuild the reference after the lifecycle boundary. Historical candles
   // remain available for geometry, but no pre-close A, B or wave survives.
   wave=makeWave(closed,ref,direction,i,entryAfter>0?Math.max(firstFresh,start??0):start,entryAfter);
  }
  return wave?.model||null;
 }
 function analyze({bars=[],side,price,liveBar,now=Date.now(),pocResetAfter=0}){
  const entryAfter=Number(pocResetAfter)||0;
  if(!['LONG','SHORT'].includes(side))throw Error('INVALID_POC_SIDE');
  const closed=bars.filter(b=>b.closed!==false&&b.closeTime<=now),states={channel:'unknown',break:'unknown',poc:'unknown',range:'unknown'};
  const replayed=replay(closed,entryAfter),model=replayed?.side===side?replayed:null;
  let reason;
  if(model){
   states.channel='passed';states.break='passed';states.range=model.consolidation.passed?'passed':'waiting';
   const pc=model.profile?.poc,previous=closed.at(-1),outside=positive(pc)&&(side==='LONG'?previous.close>pc:previous.close<pc);
   // Touch during the current return, not an old wick followed by a bounce.
   const pendingExtreme=liveBar&&(side==='LONG'?liveBar.high>model.anchorB.price:liveBar.low<model.anchorB.price);
   const touched=!pendingExtreme&&outside&&liveBar?.openTime>=model.frozenAt&&(side==='LONG'?price<=pc&&liveBar.low<=pc:price>=pc&&liveBar.high>=pc);
   states.poc=!model.profile?'unknown':touched?'passed':'waiting';
   reason=!model.consolidation.passed?model.consolidation.reason:!model.profile?'WAIT_POC_VOLUME_DATA':pendingExtreme?'WAIT_POC_WAVE_CLOSE':!touched?'WAIT_POC_RETEST':'CHANNEL_POC_READY';
  }else{
   const h=closed.slice(-50),c=geometry(h);
   states.channel=c?'passed':'waiting';
   if(c){const range=initialRange(h,c,side,entryAfter);states.range=range.passed?'passed':'waiting';states.break='waiting';reason=range.passed?'WAIT_POC_CHANNEL_BREAKOUT':range.reason;}
   else reason='WAIT_CHANNEL_TWO_TOUCHES';
  }
  const conditions={version:REPORT,side,at:now,expiresAt:(Math.floor(now/STEP)+1)*STEP,rows:Object.entries(states).map(([id,state])=>({id,state})),model,chart:model?{interval:'5m',bars:[...closed.slice(-79),...(liveBar?[liveBar]:[])].map(({openTime,closeTime,open,high,low,close,volume,closed})=>({openTime,closeTime,open,high,low,close,volume,closed})),price,at:now}:null};
  return {ready:Object.values(states).every(s=>s==='passed'),reason,model,conditions};
 }
 root.LEVI_CHANNEL_POC=Object.freeze({VERSION,REPORT,STEP,ANCHOR_POLICY,consolidationPolicy,profile,initialRange,geometry,freeze,analyze});
})(globalThis);
