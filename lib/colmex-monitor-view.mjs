// Read-only presentation of recorded server activity, never a trading trigger.
export function monitorView(data,now=Date.now()){
 const completed=Number(data.lastCompletedAt)||0;
 const age=completed?Math.max(0,now-completed):null;
 const health=!data.enabled?'disabled':data.lastError||data.halt?'error':!completed?'waiting':age>300000?'stale':'recent';
 const symbols=[...new Set([...(data.policy?.symbols||[]),...Object.keys(data.checks||{})])];
 const rows=symbols.map(symbol=>{
  const check=data.checks?.[symbol];const at=Number(check?.at)||null;
  return {symbol,at,entryRsi:Number.isFinite(check?.entryRsi)?check.entryRsi:null,reason:check?.reason||null,entryBlockReason:check?.entryBlockReason||null,state:!at?'unseen':now-at>1800000?'old':'checked'};
 });
 const scan=data.scanActivity,observationScanning=data.enabled===true&&!data.lastError&&scan?.mode==='OBSERVATION_ONLY'&&scan.dataAvailable===true&&Number.isFinite(scan.at)&&scan.at<=now&&now-scan.at<=180000;
 return {health,age,completed:completed||null,checked:rows.filter(r=>r.at).length,total:rows.length,rows,observationScanning};
}
