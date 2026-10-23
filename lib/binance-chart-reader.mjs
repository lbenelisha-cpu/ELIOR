import {chartWindow,CHART_INTERVALS,aggregateFiveHourCandles} from './chart-timeframes.mjs';
// Read-only UI cache. Execution and strategy history never consume this reader.
export function createChartReader(fetchJson,{now=Date.now,maxEntries=12,ttlMs=15000}={}){
 const cache=new Map(),pending=new Map();
 async function read(symbol,interval,range){
  const key=[symbol,interval,range].join(':'),at=now(),saved=cache.get(key);
  if(saved&&at>=saved.at&&at-saved.at<ttlMs)return saved.value;
  if(pending.has(key))return pending.get(key);
  const operation=(async()=>{
   const window=chartWindow(interval,range,at),duration=CHART_INTERVALS[window.sourceInterval];
   const start=saved?Math.max(window.fetchStartTime,saved.rows.at(-1).openTime):window.fetchStartTime;
   const pages=[];for(let cursor=start;cursor<=at;cursor+=1000*duration)pages.push(cursor);
   if(pages.length>15)throw Error('CHART_WINDOW_TOO_LARGE');
   const added=[];
   for(let i=0;i<pages.length;i+=3){
    const batches=await Promise.all(pages.slice(i,i+3).map(cursor=>fetchJson('/api/v3/klines?symbol='+encodeURIComponent(symbol)+'&interval='+window.sourceInterval+'&limit=1000&startTime='+cursor+'&endTime='+Math.min(at,cursor+1000*duration-1))));
    for(const batch of batches){if(!Array.isArray(batch))throw Error('INVALID_CHART_HISTORY');for(const row of batch)added.push({openTime:+row[0],open:+row[1],high:+row[2],low:+row[3],close:+row[4],volume:+row[5],closeTime:+row[6],closed:+row[6]<at});}
   }
   if(!added.length)throw Error('WAIT_CURRENT_CHART_HISTORY');
   const rows=[...new Map([...(saved?.rows||[]),...added].map(c=>[c.openTime,c])).values()].filter(c=>c.openTime>=window.fetchStartTime&&c.openTime<=at).sort((a,b)=>a.openTime-b.openTime);
   if(!rows.length||rows.some(c=>!Number.isFinite(c.closeTime)||!['open','high','low','close'].every(k=>Number.isFinite(c[k])&&c[k]>0)||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)))throw Error('INVALID_CHART_HISTORY');
   const value={visibleStartTime:window.visibleStartTime,candles:interval==='5h'?aggregateFiveHourCandles(rows):rows};
   cache.delete(key);cache.set(key,{at,value,rows});while(cache.size>maxEntries)cache.delete(cache.keys().next().value);
   return value;
  })();
  pending.set(key,operation);try{return await operation;}finally{if(pending.get(key)===operation)pending.delete(key);}
 }
 return {read};
}
