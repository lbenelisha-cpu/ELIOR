import {analyzePositionAlpha,compactPositionAlpha} from './position-alpha.mjs';
import {getStore} from '@netlify/blobs';
import {makeAuditRecord,collectAudit,appendAuditBatch,auditSnapshots} from './ma-decision-audit.mjs';
import {stockSessionGap} from './colmex-market-hours.mjs';
export const maAuditStore=()=>getStore({name:'levi-ma-decision-audit-v1',consistency:'strong'});
export const colmexAuditPrefix=account=>'colmex-'+account;
export function createColmexAudit(state,contexts={},now=Date.now){
 state.maAudit??={rows:[],last:{}};
 return event=>{try{
  const at=event.at??now();
  const position=event.position??state.positions?.find(p=>p.symbol===event.symbol)??null;
  if(event.bars)contexts[event.symbol]={checks:auditSnapshots(event.bars,at,stockSessionGap),positionAlpha:compactPositionAlpha(analyzePositionAlpha(event.bars,position,{now:at}))};
  const context=contexts[event.symbol];
  const row=makeAuditRecord({platform:'COLMEX',priceClock:'BROKER_RECEIPT',...event,position,at,snapshots:Array.isArray(context)?context:context?.checks,positionAlpha:context?.positionAlpha,isSessionGap:stockSessionGap});
  collectAudit(state.maAudit,row);if(state.maAudit.dropped)state.maAudit.error='AUDIT_BUFFER_CAPACITY';
 }catch{state.maAudit.error='AUDIT_CAPTURE_FAILED';}};
}
export async function flushColmexAudit(store,account,state,now=Date.now()){
 const audit=state.maAudit;if(!audit)return;
 const batch=[...(audit.rows||[])];
 try{await appendAuditBatch(store,colmexAuditPrefix(account),batch,now);audit.rows=[];audit.lastPersistedAt=now;audit.error=audit.dropped?'AUDIT_BUFFER_CAPACITY':null;}
 catch{audit.error='AUDIT_STORAGE_UNAVAILABLE';} // Outbox survives in the existing durable trading-state saves.
}
