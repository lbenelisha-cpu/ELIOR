const minutes={'5min':5,'10min':10,'15min':15,'1h':60};
export function aggregateStockCandles(bars,interval,now=Date.now()){
 const duration=minutes[interval];if(![10,15,60].includes(duration))throw Error('UNSUPPORTED_AGGREGATION');
 const groups=new Map();
 for(const bar of bars){const at=Date.parse(bar.date);if(!Number.isFinite(at)||at%300000!==0)throw Error('INVALID_5M_TIME');
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at)).map(p=>[p.type,p.value])),minute=Number(p.hour)*60+Number(p.minute);
  if(minute<570||minute>=960)continue;
  const start=at-((minute-570)%duration)*60000,key=p.year+p.month+p.day+':'+start;if(!groups.has(key))groups.set(key,{start,rows:[]});groups.get(key).rows.push(bar);
 }
 return [...groups.values()].sort((a,b)=>a.start-b.start).flatMap(({start,rows})=>{
  rows.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));const minuteParts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(start)),local=Object.fromEntries(minuteParts.map(p=>[p.type,p.value])),bucketMinutes=Math.min(duration,960-(Number(local.hour)*60+Number(local.minute))),expected=bucketMinutes/5;const times=rows.map(b=>Date.parse(b.date));if(new Set(times).size!==times.length)throw Error('DUPLICATE_5M_BAR');
  // Never manufacture a full historical candle from a missing constituent.
  if(times[0]!==start||times.some((t,i)=>t!==start+i*300000)||rows.length!==expected&&now>=start+bucketMinutes*60000)return [];
  return [{date:new Date(start).toISOString(),open:rows[0].open,high:Math.max(...rows.map(b=>b.high)),low:Math.min(...rows.map(b=>b.low)),close:rows.at(-1).close,closed:now>=start+bucketMinutes*60000}];
 });
}
