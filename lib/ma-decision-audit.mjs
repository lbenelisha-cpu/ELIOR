import {analyzePositionAlpha,compactPositionAlpha,cachedPositionAlpha,positionQuoteChange} from './position-alpha.mjs';
import {createHash} from 'node:crypto';
import {analyzeScheduledSlope} from './ma-slope-schedule.mjs';
import {slopeDecision} from './ma-slope-decision.mjs';
export const AUDIT_VERSION='MA100_200_OBSERVATION_V1';
export const AUDIT_HOUR=3600000;
const number=value=>Number.isFinite(value)?value:null;
const positive=value=>Number.isFinite(value)&&value>0?value:null;
const code=value=>String(value||'UNKNOWN').replace(/[^A-Za-z0-9_:.-]/g,'_').slice(0,120);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,32);
const reading=value=>value?{average:number(value.average),pctPerMinute:number(value.pctPerMinute),angle:number(value.angle),closeTime:number(value.closeTime)}:null;
export function auditSnapshots(bars,at,isSessionGap){
 return [10,20].map(checkMinutes=>{
  const value=analyzeScheduledSlope(bars,{now:at,checkMinutes,isSessionGap});
  return {checkMinutes,status:value.status,checkAt:value.checkAt??null,asOf:value.asOf??null,latestDataAt:value.latestDataAt??null,capturedAt:at,
   state:slopeDecision(value,'LONG').state,ma100:reading(value.fast),ma200:reading(value.slow),previousMa100:reading(value.previousFast)};
 });
}
export function auditComparison(action,snapshot){
 if(snapshot.state==='UNAVAILABLE')return 'UNAVAILABLE';
 if(action==='ENTER')return snapshot.state==='ENTRY_SUPPORT'?'SUPPORTS':['EXIT_WARNING','REVERSAL_PENDING'].includes(snapshot.state)?'OPPOSES':'MIXED';
 if(action==='EXIT')return snapshot.state==='EXIT_WARNING'?'SUPPORTS':snapshot.state==='ENTRY_SUPPORT'?'OPPOSES':'MIXED';
 if(action==='HOLD')return snapshot.state==='ENTRY_SUPPORT'?'SUPPORTS':snapshot.state==='EXIT_WARNING'?'OPPOSES':'MIXED';
 return 'NOT_COMPARABLE'; // No entry, a protection update or a broker report is not a contrary MA signal.
}
export function makeAuditRecord({platform,symbol,at=Date.now(),action='WAIT',stage='EVALUATION',reason,price,priceAt,priceClock='SOURCE',origin='AUTOMATIC',reference=null,bars,snapshots,isSessionGap,position=null,positionBars,positionAlpha}){
 if(!['BINANCE','COLMEX'].includes(platform)||!/^[A-Z0-9][A-Z0-9._-]{0,29}$/.test(symbol||'')||!Number.isFinite(at))throw Error('INVALID_AUDIT_EVENT');
 if(!['ENTER','EXIT','HOLD','WAIT','PROTECT'].includes(action))throw Error('INVALID_AUDIT_ACTION');
 const source=bars?auditSnapshots(bars,at,isSessionGap):snapshots||auditSnapshots([],at);
 const checks=[10,20].map(minutes=>{
  const old=source.find(item=>item.checkMinutes===minutes),checkAt=Math.floor(at/(minutes*60000))*minutes*60000;
  let item=old?structuredClone(old):{checkMinutes:minutes,status:'NO_DATA',state:'UNAVAILABLE'};
  if(item.status==='READY'&&(!(item.capturedAt<=at)||item.checkAt!==checkAt||!(item.latestDataAt<=at)||at-item.latestDataAt>600000)){item={...item,status:'STALE',state:'UNAVAILABLE'};}
  return {...item,comparison:(origin==='BROKER'||['BROKER_FILL','CLOSE_OBSERVED'].includes(stage))?'NOT_COMPARABLE':auditComparison(action,item)};
 });
 const alpha=positionBars||bars?compactPositionAlpha(analyzePositionAlpha(positionBars||bars,position,{now:at})):cachedPositionAlpha(positionAlpha,position,at);
 alpha.quote=positionQuoteChange(alpha.reference,price,priceAt,at);
 const record={positionAlpha:alpha,version:AUDIT_VERSION,platform,symbol,at,side:'LONG',origin:code(origin),stage:code(stage),action,reason:code(reason),reference:reference==null?null:code(reference),
  price:positive(price),priceAt:number(priceAt),priceClock:code(priceClock),priceFresh:positive(price)!==null&&Number.isFinite(priceAt)&&priceAt<=at&&at-priceAt<=15000,checks};
 if(!record.priceFresh&&stage==='EVALUATION')for(const check of checks)check.comparison='UNAVAILABLE';
 record.signature=digest([platform,symbol,origin,stage,action,record.reason,record.reference,Math.floor(at/600000),[alpha.reference?.key,alpha.status,alpha.asOf,alpha.recent?.status],checks.map(c=>[c.checkMinutes,c.checkAt,c.status,c.state,c.comparison])]);
 record.id=reference==null?digest([record.signature,at]):digest([platform,symbol,record.stage,origin,String(reference)]);
 return record;
}
// Identical evaluation states are sampled once per ten-minute bucket. Every
// distinct order reference/stage is retained; a changed decision is retained too.
export function collectAudit(state,record,{limit=300}={}){
 const key=record.symbol+':'+record.stage+':'+record.origin;
 state.last??={};state.rows??=[];
 if(record.stage==='EVALUATION'&&state.last[key]===record.signature)return false;
 if(state.rows.some(row=>row.id===record.id))return false;
 if(state.rows.length>=limit){state.dropped=(state.dropped||0)+1;return false;}
 state.last[key]=record.signature;state.rows.push(record);return true;
}
export const auditHourKey=(prefix,at)=>prefix+'/hour/'+Math.floor(at/AUDIT_HOUR);
export async function appendAuditBatch(store,prefix,rows,at=Date.now()){
 const groups=new Map();
 for(const row of rows){const key=auditHourKey(prefix,row.at);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
 let added=0;
 for(const [key,batch]of groups){
  const old=await store.get(key,{type:'json'});
  if(old&&(old.version!==AUDIT_VERSION||!Array.isArray(old.rows)))throw Error('AUDIT_STORAGE_SCHEMA');
  const existing=old?.rows||[],ids=new Set(existing.map(row=>row.id)),next=batch.filter(row=>!ids.has(row.id)&&(ids.add(row.id),true));
  if(existing.length+next.length>10000)throw Error('AUDIT_HOUR_CAPACITY');
  if(next.length)await store.setJSON(key,{version:AUDIT_VERSION,rows:[...existing,...next]});added+=next.length;
 }
 const prior=await store.get(prefix+'/health',{type:'json'});
 const health={version:AUDIT_VERSION,startedAt:prior?.startedAt??Math.min(at,...rows.map(r=>r.at)),lastPersistedAt:at,lastRecordAt:Math.max(prior?.lastRecordAt||0,...rows.map(r=>r.at))};
 await store.setJSON(prefix+'/health',health);return health;
}
export function auditOutcomes(row,observations,now){
 return [10,20,60].map(minutes=>{
  const dueAt=row.at+minutes*60000,match=observations.find(p=>p.priceFresh&&p.at>=dueAt&&p.at<=dueAt+300000&&p.priceAt>=dueAt&&p.priceAt<=now);
  return !row.priceFresh?{minutes,status:'BASE_PRICE_UNAVAILABLE'}:match?{minutes,status:'OBSERVED',at:match.priceAt,price:match.price,changePct:(match.price/row.price-1)*100}:{minutes,status:now<dueAt?'PENDING':now<=dueAt+300000?'WAIT_OBSERVATION':'NO_OBSERVATION'};
 });
}
export async function readAuditJournal(store,prefix,{now=Date.now(),symbol='',limit=200}={}){
 if(symbol&&!/^[A-Z0-9][A-Z0-9._-]{0,29}$/.test(symbol))throw Error('INVALID_SYMBOL');
 const health=await store.get(prefix+'/health',{type:'json'}),from=now-24*AUDIT_HOUR,first=Math.floor(from/AUDIT_HOUR),last=Math.floor(now/AUDIT_HOUR),rows=[];
 // Bound I/O concurrency and the response; retain original source timestamps.
 for(let hour=first;hour<=last;hour+=5){
  const batches=await Promise.all(Array.from({length:Math.min(5,last-hour+1)},(_,i)=>store.get(prefix+'/hour/'+(hour+i),{type:'json'})));
  for(const batch of batches){if(batch&&(batch.version!==AUDIT_VERSION||!Array.isArray(batch.rows)))throw Error('AUDIT_STORAGE_SCHEMA');rows.push(...(batch?.rows||[]).filter(r=>r.at>=from&&r.at<=now&&(!symbol||r.symbol===symbol)));}
 }
 rows.sort((a,b)=>a.at-b.at);
 const ids=new Set();for(let i=0;i<rows.length;){if(ids.has(rows[i].id))rows.splice(i,1);else{ids.add(rows[i].id);i++;}}
 const observations=new Map();for(const row of rows){if(!observations.has(row.symbol))observations.set(row.symbol,[]);observations.get(row.symbol).push(row);}
 const selected=rows.slice(-Math.min(500,Math.max(1,Number(limit)||200))).reverse().map(row=>({...row,outcomes:auditOutcomes(row,observations.get(row.symbol),now)}));
 return {ok:true,version:AUDIT_VERSION,comparisonOnly:true,windowHours:24,from,asOf:now,health:health||null,stale:!health||now-health.lastPersistedAt>180000,total:rows.length,rows:selected};
}
