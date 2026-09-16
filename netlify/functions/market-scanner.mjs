import {WATCHLIST,db,fresh,score} from '../../lib/agent.mjs';
export async function handler(){
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
 try{
  // Reuse the scheduled scan: viewing recommendations never counts as a new vote.
  const saved=await db('paper_rotation_scans?select=*&order=slot.desc&limit=3').catch(()=>[]);
  if(saved.length&&Date.now()-Date.parse(saved[0].slot)<35*60000){
   const row=saved[0],candidates=WATCHLIST.map(symbol=>({symbol,name:symbol,...row.candidates[symbol]})).sort((a,b)=>b.master-a.master||a.symbol.localeCompare(b.symbol));
   let count=0;const seen=new Set();
   for(let i=0;i<saved.length;i++){
    const h=saved[i];if(h.symbol!==row.symbol||h.score<60||Date.parse(row.slot)-Date.parse(h.slot)!==i*1800000||seen.has(h.bar_time))break;
    seen.add(h.bar_time);count++;
   }
   return {statusCode:200,headers,body:JSON.stringify({generated_at:row.slot,candidates,warnings:[],leader:{symbol:row.symbol,score:row.score,consecutive:count,required:3,verified:count===3,status:count===3?'מועמד מאומת; מעבר דורש יתרון של 10 נקודות על תוכנית שמאפשרת מעבר':'ממתין ל־3 סריקות סוכן רצופות'}})};
  }
  const warnings=[],candidates=[];
  const cached=await db('paper_market_cache?select=key,payload,expires_at&order=expires_at.desc&limit=100');
  for(const symbol of WATCHLIST){
   const row=cached.find(x=>x.key.startsWith('time_series:')&&x.key.includes(JSON.stringify(['symbol',symbol]))&&x.key.includes(JSON.stringify(['interval','30min']))&&x.payload?.values?.length);
   if(!row){warnings.push(symbol+': ממתין לאיסוף נתונים בסוכן');continue;}
   const q={...score(row.payload.values),updated_at:row.payload.values[0].datetime};
   candidates.push({symbol,name:symbol,...q,stale:!fresh(q.updated_at)});
  }
  if(!candidates.length)throw Error('ממתין לאיסוף נתונים בהרצת הסוכן. רענון הסריקה אינו שולח בקשות לספק.');
  candidates.sort((a,b)=>b.master-a.master||a.symbol.localeCompare(b.symbol));
  return {statusCode:200,headers,body:JSON.stringify({generated_at:new Date().toISOString(),candidates,warnings,leader:{symbol:candidates[0].symbol,score:candidates[0].master,consecutive:0,required:3,verified:false,status:'תצוגת מועמדים; אימות וביצוע נעשים בהרצות הסוכן בלבד'}})};
 }catch(e){return {statusCode:503,headers,body:JSON.stringify({error:e.message})};}
}
