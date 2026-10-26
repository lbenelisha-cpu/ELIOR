import {getStore} from '@netlify/blobs';
import {runtimeEnvironment} from '../../lib/colmex-auto-policy.mjs';
import {deviceStoreName,requireDevice} from '../../lib/colmex-device-access.mjs';
import {autoStore,stateKey} from '../../lib/colmex-auto-store.mjs';
import {maAuditStore,colmexAuditPrefix} from '../../lib/colmex-ma-audit.mjs';
import {readAuditJournal} from '../../lib/ma-decision-audit.mjs';
export function makeAuditHandler({env=process.env,deviceStoreFactory=()=>getStore({name:deviceStoreName,consistency:'strong'}),storeFactory=maAuditStore,stateStoreFactory=autoStore}={}){
 return async(request,context)=>{
  const vars=runtimeEnvironment(env,context),reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(request.method!=='GET')return reply(405,{ok:false,error:'METHOD_NOT_ALLOWED'});
  try{
   await requireDevice(deviceStoreFactory(),vars,request.headers.get('authorization'));
   const symbol=new URL(request.url).searchParams.get('symbol')||'';
   if(symbol&&!/^[A-Z0-9][A-Z0-9._-]{0,29}$/.test(symbol))return reply(400,{ok:false,error:'INVALID_SYMBOL'});
   const [data,saved]=await Promise.all([readAuditJournal(storeFactory(),colmexAuditPrefix(vars.COLMEX_AUTO_ACCOUNT_ID),{symbol}),stateStoreFactory().get(stateKey(vars.COLMEX_AUTO_ACCOUNT_ID),{type:'json'})]);
   const audit=saved?.state?.maAudit;
   return reply(200,{...data,storageError:audit?.error||null,pending:audit?.rows?.length||0,dropped:audit?.dropped||0});
  }catch(error){return reply(error.status===401?401:503,{ok:false,error:error.status===401?'DEVICE_REQUIRED':'AUDIT_READ_UNAVAILABLE'});}
 };
}
export default makeAuditHandler();
