import fs from 'node:fs';
import path from 'node:path';
import {spotPnlRows,shortPnlPlaceholder,readShortPnl} from './binance-trading-pnl.mjs';

const stamp=p=>JSON.stringify([p.symbol,p.entryOrderId,p.entryAt,p.closedAt,p.reason]);
const allowedIssues=new Set(['INVALID_CLOSED_POSITION','EXCHANGE_HISTORY_EXPIRED','ENTRY_ORDER_UNVERIFIED','HISTORY_LIMIT_REACHED','INVALID_EXCHANGE_HISTORY']);
// Separate accounting cache. This reader has no execution API or journal writer.
export function createTradingPnlReader({get,now=Date.now,file=null,initial=null,save=null}){
 let saved=initial,cacheError=null,job=null;
 if(file){try{saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')cacheError='PNL_CACHE_UNAVAILABLE';}}
 const cache=new Map();
 if(saved?.version===1&&Array.isArray(saved.entries))for(const e of saved.entries){
  if(typeof e.key==='string'&&Number.isFinite(e.at)&&e.row?.direction==='SHORT'&&Number.isFinite(e.row?.netPnlUsdt)&&Number.isFinite(e.row?.closedAt))cache.set(e.key,e);
 }
 function persist(){
  try{
   const data={version:1,entries:[...cache.values()].filter(e=>e.row.netPnlUsdt!==null&&now()-e.row.closedAt>300000).slice(-500)};
   if(file){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(data),{mode:0o600});fs.renameSync(file+'.tmp',file);}
   if(save)save(data);cacheError=null;
  }catch{cacheError='PNL_CACHE_UNAVAILABLE';}
 }
 function pending(p){const e=cache.get(stamp(p));return !e||e.row.issue&&now()-e.at>=60000||!e.row.issue&&now()-Number(p.closedAt)<300000&&now()-e.at>=30000;}
 function read(actions,closed,{spotHealthy=true,shortHealthy=true}={}){
  const positions=shortHealthy?(Array.isArray(closed)?structuredClone(closed):[]):[];
  // Bound each refresh so reporting cannot flood the trading connection.
  const tasks=positions.filter(pending).slice(-5).reverse();
  if(!job&&tasks.length){
   job=(async()=>{
    for(const p of tasks){
     let row;try{row=await readShortPnl(p,get,now());}catch(error){row=shortPnlPlaceholder(p,allowedIssues.has(error.message)?error.message:'EXCHANGE_HISTORY_UNAVAILABLE');}
     const key=stamp(p);cache.set(key,{key,at:now(),row});
     if(cache.size>500)cache.delete(cache.keys().next().value);
     persist();
    }
   })().finally(()=>{job=null;});
  }
  const rows=[...(spotHealthy?spotPnlRows(actions):[]),...positions.map(p=>{
   const value=cache.get(stamp(p));return value?{...value.row,checkedAt:value.at}:shortPnlPlaceholder(p);
  })].sort((a,b)=>b.closedAt-a.closedAt);
  return {ok:true,asOf:now(),loadingShort:!!job,rows,health:{spot:spotHealthy,short:shortHealthy,cache:cacheError===null},scope:{spot:'RETAINED_APP_FILLS',short:'RETAINED_CLOSED_POSITIONS',shortLimit:100},issues:[...(!spotHealthy?['SPOT_JOURNAL_UNAVAILABLE']:[]),...(!shortHealthy?['SHORT_JOURNAL_UNAVAILABLE']:[]),...(cacheError?[cacheError]:[])]};
 }
 return {read,settled:async()=>{if(job)await job;}};
}
