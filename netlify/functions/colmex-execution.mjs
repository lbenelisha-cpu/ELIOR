import {timingSafeEqual,randomUUID} from 'node:crypto';
import {CONFIG,validateSnapshot,planCycle} from '../../lib/colmex-execution.mjs';
const reply=(statusCode,data,text=false)=>({statusCode,headers:{'Content-Type':text?'text/plain; charset=utf-8':'application/json; charset=utf-8','Cache-Control':'no-store'},body:text?data:JSON.stringify(data)});
function auth(e){const key=process.env[e.httpMethod==='GET'?'COLMEX_DEMO_READ_TOKEN':'COLMEX_DEMO_EXECUTION_TOKEN'];const actual=(e.headers?.authorization||e.headers?.Authorization||'').replace(/^Bearer /,'');if(!key||key.length<32)return false;const a=Buffer.from(actual),b=Buffer.from(key);return a.length===b.length&&timingSafeEqual(a,b);}
async function db(path,options={}){
 const url=(process.env.SUPABASE_URL||'').trim().replace(/\/+$/,'').replace(/\/rest\/v1$/i,'');const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw Error('DB_CONFIG');
 const r=await fetch(url+'/rest/v1/'+path,{...options,signal:AbortSignal.timeout(12000),headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation',...options.headers}});
 const d=await r.json();if(!r.ok)throw Error('DB_'+r.status+'_'+(/^[A-Z0-9]{1,12}$/.test(d.code)?d.code:'ERROR'));return d;
}
export function wire(c){return ['EXEC',c.id,c.action,c.program,c.symbol,c.lots,c.ticket,c.expires,c.cap,c.target,c.spec.fxSymbol,c.spec.contractSize,c.spec.unit,c.magic].join('|');}
export async function handler(e){
 if(!['GET','POST'].includes(e.httpMethod))return reply(405,{error:'Method not allowed'});
 if(!auth(e))return reply(401,{error:'מפתח חיבור שגוי'});
 if(process.env.COLMEX_DEMO_ACCOUNT!==CONFIG.account||process.env.COLMEX_DEMO_SERVER!==CONFIG.server)return reply(503,{error:'חשבון הדמו אינו מוגדר כנדרש'});
 try{
  const state=(await db('colmex_execution_state?id=eq.1&select=*'))[0];
  if(!state)throw Error('DB_MIGRATION_REQUIRED');
  const enabled=process.env.COLMEX_DEMO_EXECUTION_ENABLED==='true';
  if(e.httpMethod==='GET'){
   const [commands,scans]=await Promise.all([db('colmex_execution_commands?select=*&order=created_at.desc&limit=10'),db('colmex_execution_scans?select=*&order=bar_time.desc&limit=10')]);
   const stale=!state.received_at||Date.now()-Date.parse(state.received_at)>60000;
   return reply(200,{enabled,stale,receivedAt:state.received_at,summary:state.summary,orders:state.snapshot?.orders||[],terminalEnabled:state.snapshot?.enabled||false,commands,scans,policy:CONFIG});
  }
  if(e.isBase64Encoded||(e.body||'').length>500000)return reply(413,{error:'Payload too large'});
  let snap;try{snap=validateSnapshot(JSON.parse(e.body||'{}'));}catch{return reply(400,{error:'Invalid demo snapshot'});}
  const [market,scans,closed,recentCommands]=await Promise.all([db('colmex_market_state?id=eq.1&select=*'),db('colmex_execution_scans?select=*&order=bar_time.desc&limit=3'),db('rpc/colmex_execution_read_ledger',{method:'POST',body:'{}'}),db('colmex_execution_commands?select=*&order=created_at.desc&limit=20')]);
  if(closed.length>=10000)throw Error('LEDGER_LIMIT');
  const summary=planCycle(snap,market[0],scans,closed,Date.now()/1000,recentCommands);
  let command=enabled&&snap.enabled?summary.command:null;
  if(command)command={...command,id:randomUUID(),expires:Math.floor(Date.now()/1000)+20};
  const stored={...summary};delete stored.command;
  const exchange=await db('rpc/colmex_execution_exchange',{method:'POST',body:JSON.stringify({p_version:state.version,p_snapshot:snap,p_summary:stored,p_scan:summary.complete?summary.scan:null,p_command:command})});
  return reply(200,exchange.command?wire(exchange.command):'WAIT|'+(exchange.wait||(exchange.pending?'pending-result':enabled?'monitoring':'server-disabled')),true);
 }catch(err){const safe=/^(DB_[A-Z0-9_]+|LEDGER_LIMIT)$/.test(err.message)?err.message:'SERVICE_UNAVAILABLE';return reply(503,{error:safe});}
}
