export const FIVE_MINUTE_MS=300000;
export const FIVE_MINUTE_HISTORY_MS=7*86400000;
export async function loadFiveMinuteBars(fetchJson,symbol,now=Date.now()){
 const end=Math.floor(now/FIVE_MINUTE_MS)*FIVE_MINUTE_MS-1;
 const start=end+1-FIVE_MINUTE_HISTORY_MS;
 const rows=[];let cursor=start;
 for(let page=0;page<3&&cursor<=end;page++){
  const batch=await fetchJson('/api/v3/klines?symbol='+encodeURIComponent(symbol)+'&interval=5m&limit=1000&startTime='+cursor+'&endTime='+end);
  if(!Array.isArray(batch))throw Error('INVALID_5M_HISTORY');
  if(!batch.length)break;
  rows.push(...batch.filter(x=>Number(x[0])>=start&&Number(x[6])<=end));
  const next=Number(batch.at(-1)[6])+1;
  if(!Number.isFinite(next)||next<=cursor)throw Error('INVALID_5M_PAGINATION');
  cursor=next;
 }
 const bars=[...new Map(rows.map(x=>[Number(x[6]),x])).values()].sort((a,b)=>Number(a[6])-Number(b[6])).map(x=>({openTime:Number(x[0]),closeTime:Number(x[6]),open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4]),volume:Number(x[5]),timeframe:'5m',closed:true}));
 if(!bars.length||bars.at(-1).closeTime!==end)throw Error('WAIT_CURRENT_5M_HISTORY');
 return bars;
}
