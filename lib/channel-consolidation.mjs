// Entry filter shared by Binance and Colmex. These thresholds define the
// owner's rule; they are not a measured probability of a profitable trade.
export const CHANNEL_CONSOLIDATION_POLICY=Object.freeze({version:'CHANNEL_CONSOLIDATION_V1',minBars:3,maxBars:8,maxRangeFraction:.35,maxDriftFraction:.5,lowerZone:1/3,upperZone:2/3,missing:'BLOCK',middle:'ALLOW_BOTH',selection:'LATEST_CLOSED_BEFORE_SIGNAL'});
const finite=Number.isFinite;

export function channelConsolidation({history,channel,side,price,signalTime}){
 const p=CHANNEL_CONSOLIDATION_POLICY;
 const reject=(reason,detail={})=>({version:p.version,side,passed:false,reason,...detail});
 if(!['LONG','SHORT'].includes(side)||!Array.isArray(history)||!channel?.ready||![channel.width,channel.intercept,channel.slope,channel.start,channel.anchorStart,channel.duration,price,signalTime].every(finite)||channel.width<=0||channel.duration!==300000||price<=0)return reject('INVALID_CHANNEL_CONSOLIDATION');
 if(history.some((b,i)=>b.closed===false||!finite(b.openTime)||!finite(b.closeTime)||b.closeTime>signalTime||b.closeTime-b.openTime!==300000||i>0&&b.openTime<history[i-1].closeTime||!['open','high','low','close'].every(k=>finite(b[k])&&b[k]>0)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)))return reject('INVALID_CHANNEL_CONSOLIDATION');
 const first=Math.max(0,Math.ceil((channel.anchorStart-channel.start)/channel.duration)),width=channel.width*2;
 // Examine every location in the current swing channel, not just its beginning.
 // Latest end wins; prefer the longest qualifying window with that same end.
 for(let end=history.length-1;end>=first+p.minBars-1;end--){
  for(let count=Math.min(p.maxBars,end-first+1);count>=p.minBars;count--){
   const start=end-count+1,bars=history.slice(start,end+1);
   // An overnight/weekend gap is valid stock history, but is not one sideways range.
   if(bars.some((b,i)=>i>0&&b.openTime!==bars[i-1].closeTime))continue;
   const low=Math.min(...bars.map(b=>b.low)),high=Math.max(...bars.map(b=>b.high)),range=high-low;
   if(!(range>0)||range/width>p.maxRangeFraction)continue;
   const driftFraction=Math.abs(bars.at(-1).close-bars[0].close)/range;
   if(driftFraction>p.maxDriftFraction)continue;
   const locations=bars.map((b,i)=>((b.high+b.low)/2-(channel.intercept+channel.slope*(start+i)-channel.width))/width);
   if(locations.some(v=>v<0||v>1))continue;
   const location=locations.reduce((s,v)=>s+v,0)/count;
   const zone=location<=p.lowerZone?'LOWER':location>=p.upperZone?'UPPER':'MIDDLE';
   const detail={zone,location,startAt:bars[0].openTime,endAt:bars.at(-1).closeTime,bars:count,low,high,rangeFraction:range/width,driftFraction,barsSince:history.length-1-end};
   if(side==='LONG'&&zone==='UPPER'||side==='SHORT'&&zone==='LOWER')return reject('CHANNEL_CONSOLIDATION_SIDE_BLOCK',detail);
   if(side==='LONG'?price<=high:price>=low)return reject('WAIT_CHANNEL_CONSOLIDATION_BREAK',detail);
   return {version:p.version,side,passed:true,reason:'CHANNEL_CONSOLIDATION_READY',...detail};
  }
 }
 return reject('WAIT_CHANNEL_CONSOLIDATION');
}

export function assertConsolidationEntry(evidence,side,price,signalTime){
 const p=CHANNEL_CONSOLIDATION_POLICY,e=evidence;
 if(!e||!['LONG','SHORT'].includes(side)||e.version!==p.version||e.side!==side||e.passed!==true||e.reason!=='CHANNEL_CONSOLIDATION_READY'||!['LOWER','MIDDLE','UPPER'].includes(e.zone)||!Number.isInteger(e.bars)||e.bars<p.minBars||e.bars>p.maxBars||![e.startAt,e.endAt,e.low,e.high,e.location,e.rangeFraction,e.driftFraction,price,signalTime].every(finite)||e.startAt<=0||e.endAt-e.startAt!==e.bars*300000||e.endAt>signalTime||e.low<=0||e.high<=e.low||e.rangeFraction<=0||e.rangeFraction>p.maxRangeFraction||e.driftFraction<0||e.driftFraction>p.maxDriftFraction||e.location<0||e.location>1)throw Error('CHANNEL_CONSOLIDATION_CHANGED');
 const zone=e.location<=p.lowerZone?'LOWER':e.location>=p.upperZone?'UPPER':'MIDDLE';
 if(zone!==e.zone||side==='LONG'&&zone==='UPPER'||side==='SHORT'&&zone==='LOWER')throw Error('CHANNEL_CONSOLIDATION_SIDE_BLOCK');
 if(side==='LONG'?price<=e.high:price>=e.low)throw Error('WAIT_CHANNEL_CONSOLIDATION_BREAK');
}

export function assertSameConsolidation(a,b){
 if(!a||!b||a.version!==CHANNEL_CONSOLIDATION_POLICY.version||b.version!==a.version||a.passed!==true||b.passed!==true||JSON.stringify(a)!==JSON.stringify(b))throw Error('CHANNEL_CONSOLIDATION_CHANGED');
}
