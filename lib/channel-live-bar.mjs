// An authoritative current 5-minute candle, not a partial reconstruction from
// trades received after process startup. Volume is cumulative, never projected.
export function validChannelLiveBar(b,now,maxAge=10000){
 return !!(b&&b.openTime===Math.floor(now/300000)*300000&&b.closeTime===b.openTime+300000&&b.closed===false&&
  Number.isFinite(b.receivedAt)&&b.receivedAt>=b.openTime&&b.receivedAt<=now&&now-b.receivedAt<=maxAge&&
  ['open','high','low','close'].every(k=>Number.isFinite(b[k])&&b[k]>0)&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&
  Number.isFinite(b.volume)&&b.volume>=0);
}
export function colmexChannelLiveBar(history,now,receivedAt){
 const matches=history?.barDetails?.filter(b=>Number(b.t)===Math.floor(now/300000)*300000);
 if(matches?.length!==1)return null;
 const b=matches[0],n=v=>v===null||v===''||typeof v==='boolean'?NaN:Number(v);
 return {openTime:n(b.t),closeTime:n(b.t)+300000,open:n(b.o),high:n(b.h),low:n(b.l),close:n(b.c),volume:n(b.v),closed:false,receivedAt};
}
