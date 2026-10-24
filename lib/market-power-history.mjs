export const POWER_INTERVALS=Object.freeze({'1h':{resolution:'1H',days:7},'1d':{resolution:'1D',days:35},'1w':{resolution:'1W',days:140},'1M':{resolution:'1M',days:730}});
export function powerHistory(history,interval,now=Date.now()){
 if(!POWER_INTERVALS[interval]||!Array.isArray(history?.barDetails))throw Error('INVALID_POWER_HISTORY');
 const result=history.barDetails.map(b=>{const t=Number(b.t),d=new Date(t);let end=t+3600000;if(interval==='1d')end=t+86400000;if(interval==='1w')end=t+7*86400000;if(interval==='1M')end=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1);return {openTime:t,closeTime:end,open:Number(b.o),high:Number(b.h),low:Number(b.l),close:Number(b.c),volume:Number(b.v)||0};});
 if(result.some(b=>!Number.isFinite(b.openTime)||!['open','high','low','close'].every(k=>b[k]>0&&Number.isFinite(b[k]))||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close))||new Set(result.map(b=>b.openTime)).size!==result.length)throw Error('INVALID_POWER_HISTORY');
 return result.filter(b=>b.closeTime<=now).sort((a,b)=>a.openTime-b.openTime).slice(-10);
}
