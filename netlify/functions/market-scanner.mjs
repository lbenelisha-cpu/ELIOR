import {WATCHLIST,db} from '../../lib/agent.mjs';
import {dailyWyckoffQuote} from '../../lib/daily-wyckoff-quotes.mjs';
// Cache-only view: no orders or provider calls.
export async function handler(){
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
 try{
  const cached=await db('paper_market_cache?select=key,payload,expires_at&order=expires_at.desc&limit=1000');
  const candidates=[],warnings=[];
  for(const symbol of WATCHLIST){
   const loader=async(endpoint,params)=>{
    const row=cached.find(x=>x.key.startsWith(endpoint+':')&&x.key.includes(JSON.stringify(['symbol',symbol]))&&(endpoint!=='time_series'||x.key.includes(JSON.stringify(['interval','1day']))));
    if(!row)throw Error('WAIT_DAILY_CACHE');return row.payload;
   };
   try{candidates.push({symbol,name:symbol,...await dailyWyckoffQuote(symbol,{loader})});}
   catch(e){warnings.push(symbol+': '+e.message);}
  }
  candidates.sort((a,b)=>b.master-a.master||a.symbol.localeCompare(b.symbol));
  const leader=candidates[0];
  return {statusCode:200,headers,body:JSON.stringify({history:[],generated_at:new Date().toISOString(),candidates,warnings,leader:leader?{symbol:leader.symbol,score:leader.master,verified:leader.wyckoff.buyConfirmed,status:'וויקוף יומי: '+leader.wyckoff.phase}:null,strategyId:'WYCKOFF_D1_V1'})};
 }catch(e){return {statusCode:503,headers,body:JSON.stringify({error:e.message})};}
}
