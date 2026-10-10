// Retain distinct analysis states; repeated scans keep a count and first/last timestamps.
export function retainDecision(rows,row){
 const time=Date.parse(row.at);
 const key=x=>JSON.stringify([x.mode,x.decision,x.reason,x.buyReason,x.entryConfirmed,x.analysisSignal,x.analysisReason,x.analysisError,x.execution,x.setup?.time,x.setup?.patternId,Math.floor(Date.parse(x.at)/3600000)]);
 const previous=rows[0];
 if(previous&&key(previous)===key(row)){
  return [{...row,firstAt:previous.firstAt||previous.at,checks:(previous.checks||1)+1},...rows.slice(1)].slice(0,2000);
 }
 return [{...row,firstAt:row.at,checks:1},...rows].filter(x=>Date.parse(x.at)>=time-90*86400000).slice(0,2000);
}
