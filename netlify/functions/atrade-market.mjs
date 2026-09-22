import {timingSafeEqual} from 'node:crypto';
import {db} from '../../lib/agent.mjs';
import {validateMarket,analyzeMarket,confirmation} from '../../lib/atrade-market.mjs';
const reply=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(data)});
function authorized(e){const expected=process.env[e.httpMethod==='GET'?'MT4_DEMO_READ_TOKEN':'MT4_DEMO_WRITE_TOKEN'];const actual=(e.headers?.authorization||e.headers?.Authorization||'').replace(/^Bearer /,'');if(!expected||expected.length<32)return false;const a=Buffer.from(actual),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);}
export async function handler(e){
 if(!['GET','POST'].includes(e.httpMethod))return reply(405,{error:'Method not allowed'});
 if(!authorized(e))return reply(401,{error:'מפתח חיבור שגוי'});
 if(process.env.MT4_DEMO_ACCOUNT!=='23091074'||process.env.MT4_DEMO_SERVER!=='Ava-Demo')return reply(503,{error:'Unexpected configured account'});
 try{
  let state;
  if(e.httpMethod==='POST'){
   if(e.isBase64Encoded||(e.body||'').length>1000000)return reply(413,{error:'Payload too large or unsupported encoding'});
   let batch;try{batch=validateMarket(JSON.parse(e.body||'{}'));}catch(err){return reply(400,{error:err.message});}
   state=await db('rpc/atrade_ingest_market',{method:'POST',body:JSON.stringify({p_batch:batch})});
  }else state=(await db('atrade_market_state?id=eq.1&select=*'))[0];
  if(state){state={...state,totalAvailable:state.total_available};}
  const analysis=analyzeMarket(state);
  // Only authenticated collector uploads can create a vote. A browser refresh never does.
  if(e.httpMethod==='POST'&&analysis.complete&&analysis.candidates.length){
   const top=analysis.candidates[0];
   await db('atrade_market_scans?on_conflict=bar_time',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({bar_time:analysis.barTime,leader:top.symbol,score:top.master,universe_id:analysis.universeId,candidates:analysis.candidates})});
  }
  const scans=await db('atrade_market_scans?select=*&order=bar_time.desc&limit=10');
  const leader=confirmation(scans);
  if(!analysis.complete||Number(scans[0]?.bar_time)!==analysis.barTime||scans[0]?.universe_id!==analysis.universeId)leader.verified=false;
  return reply(200,{...analysis,leader,history:scans,executionEnabled:false,notice:'ניתוח מחירי אטרייד בלבד. מעבר בתיק הכספי ממתין לאימות מפרטי החוזים והעלויות; אין פקודות לברוקר.'});
 }catch{return reply(503,{error:'לא ניתן לטעון או לשמור נתוני אטרייד. בדוק שהותקן SQL 008.'});}
}
