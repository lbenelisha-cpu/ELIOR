export const CHART_INTERVALS={'1m':60000,'5m':300000,'30m':1800000,'1h':3600000,'5h':18000000,'1d':86400000};
export function chartWindow(interval,range,now=Date.now()){
 if(!CHART_INTERVALS[interval])throw Error('Invalid interval');
 const days=range==='1W'?7:Number(String(range).replace('D',''));
 if(!['1D','2D','3D','4D','5D','1W'].includes(range))throw Error('Invalid range');
 const duration=CHART_INTERVALS[interval],visibleStartTime=now-days*86400000;
 const fetchStartTime=Math.max(0,Math.floor(visibleStartTime/duration)*duration-200*duration);
 return {visibleStartTime,fetchStartTime,sourceInterval:interval==='5h'?'1h':interval};
}
export function aggregateFiveHourCandles(candles){
 const groups=new Map(),duration=18000000;
 for(const c of candles){const start=Math.floor(Number(c.openTime)/duration)*duration;if(!groups.has(start))groups.set(start,[]);groups.get(start).push(c);}
 const out=[];
 for(const [start,rows] of groups){rows.sort((a,b)=>a.openTime-b.openTime);
  if(rows[0].openTime!==start||rows.some((c,i)=>c.openTime!==start+i*3600000))continue;
  out.push({openTime:start,closeTime:start+duration-1,open:rows[0].open,high:Math.max(...rows.map(c=>c.high)),low:Math.min(...rows.map(c=>c.low)),close:rows.at(-1).close,volume:rows.reduce((n,c)=>n+Number(c.volume||0),0),closed:rows.length===5&&rows.at(-1).closed!==false});
 }
 return out;
}
