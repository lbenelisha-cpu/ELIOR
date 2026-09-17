import {timingSafeEqual} from 'node:crypto';
import {db} from '../../lib/agent.mjs';
const response=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(data)});
function matches(a,b){if(!a||!b||b.length<32)return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function validate(d){
 if(d.mode!=='demo'||String(d.account)!==process.env.MT4_DEMO_ACCOUNT||d.server!==process.env.MT4_DEMO_SERVER)throw Error('Unexpected demo account or server');
 if(!/^[A-Z]{3}$/.test(d.currency))throw Error('Invalid currency');
 for(const k of ['balance','equity','profit','margin','freeMargin'])if(typeof d[k]!=='number'||!Number.isFinite(d[k]))throw Error('Invalid '+k);
 if(!Array.isArray(d.positions)||d.positions.length>300)throw Error('Invalid positions');
 const positions=d.positions.map(p=>{if(!Number.isInteger(p.ticket)||typeof p.symbol!=='string'||p.symbol.length>40||!['buy','sell','pending'].includes(p.side))throw Error('Invalid position');for(const k of ['lots','openPrice','profit','swap','commission'])if(typeof p[k]!=='number'||!Number.isFinite(p[k]))throw Error('Invalid position number');return {ticket:p.ticket,symbol:p.symbol,side:p.side,lots:p.lots,openPrice:p.openPrice,profit:p.profit,swap:p.swap,commission:p.commission};});
 return {mode:'demo',account:String(d.account),server:d.server,currency:d.currency,balance:d.balance,equity:d.equity,profit:d.profit,margin:d.margin,freeMargin:d.freeMargin,positions};
}
export async function handler(e){
 if(!['GET','POST'].includes(e.httpMethod))return response(405,{error:'Method not allowed'});
 const token=(e.headers?.authorization||e.headers?.Authorization||'').replace(/^Bearer /,'');
 if(!matches(token,process.env[e.httpMethod==='GET'?'MT4_DEMO_READ_TOKEN':'MT4_DEMO_WRITE_TOKEN']))return response(401,{error:'Invalid connection key'});
 try{
  if(e.httpMethod==='GET'){const rows=await db('mt4_demo_snapshot?id=eq.1&select=received_at,payload');const row=rows[0];return response(200,{connected:!!row&&Date.now()-Date.parse(row.received_at)<120000,...row});}
  if((e.body||'').length>150000)return response(413,{error:'Payload too large'});
  let payload;try{payload=validate(JSON.parse(e.body||'{}'));}catch(err){return response(400,{error:err.message});}
  await db('mt4_demo_snapshot?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({id:1,received_at:new Date().toISOString(),payload})});
  return response(200,{ok:true});
 }catch{return response(503,{error:'Demo storage unavailable; check SQL installation and server configuration'});}
}
