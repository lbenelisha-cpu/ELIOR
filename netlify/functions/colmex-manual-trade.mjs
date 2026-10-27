import {getStore} from '@netlify/blobs';
import {runtimeEnvironment} from '../../lib/colmex-auto-policy.mjs';
import {autoStore,lease,stateKey} from '../../lib/colmex-auto-store.mjs';
import {AutoBroker} from '../../lib/colmex-auto-broker.mjs';
import {deviceStoreName,requireDevice,sameOrigin,accessError} from '../../lib/colmex-device-access.mjs';
import {manualInput,manualTrade} from '../../lib/colmex-manual-trades.mjs';
import {pendingIntents} from '../../lib/colmex-live-state.mjs';
import {failureDiagnostic} from '../../lib/colmex-order-diagnostics.mjs';
import {releaseOrderReview} from '../../lib/colmex-order-review.mjs';
export function makeManualHandler({env=process.env,deviceStoreFactory=()=>getStore({name:deviceStoreName,consistency:'strong'}),storeFactory=autoStore,brokerFactory=options=>new AutoBroker(options),leaseFactory=lease}={}){
 return async(request,context)=>{
  const vars=runtimeEnvironment(env,context),reply=(code,data)=>new Response(JSON.stringify(data),{status:code,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  let lock;
  try{
   if(!['GET','POST'].includes(request.method))throw accessError('METHOD_NOT_ALLOWED',405);
   if(request.method==='POST'&&!sameOrigin(request))throw accessError('ORIGIN_REQUIRED',403);
   await requireDevice(deviceStoreFactory(),vars,request.headers.get('authorization'));
   const store=storeFactory();
   if(request.method==='GET'){
    const id=new URL(request.url).searchParams.get('requestId');
    if(!/^[a-f0-9-]{36}$/i.test(id||''))throw accessError('INVALID_REQUEST');
    const saved=await store.get(stateKey(vars.COLMEX_AUTO_ACCOUNT_ID),{type:'json'});
    const result=saved?.state?.manualRequests?.[id];
    const pending=saved?.state?pendingIntents(saved.state).find(i=>i.id===id):null;
    return reply(200,{ok:true,requestId:id,status:result?.status||'NOT_RECORDED',...(result?{side:result.side,symbol:result.symbol,acknowledged:!!result.acknowledged,failure:result.failure?failureDiagnostic(result.failure):null}:{}),reviewRequired:!!pending?.reviewRequired});
   }
   const raw=await request.text();if(raw.length>1000)throw accessError('INVALID_REQUEST');
   const payload=JSON.parse(raw),input=payload?.action==='release_review'?payload:manualInput(payload);
   lock=await leaseFactory(store,vars.COLMEX_AUTO_ACCOUNT_ID);if(!lock)throw accessError('TRADE_IN_PROGRESS',409);
   const deadline=Date.now()+24000;
   const result=await (input.action==='release_review'?releaseOrderReview:manualTrade)({input,state:lock.state,save:lock.save,broker:brokerFactory({env:vars,deadline}),env:vars,deadline});
   return reply(result.status==='PENDING'?202:200,{ok:true,...result});
  }catch(error){return reply(error.status||503,{ok:false,error:error.code||'TRADE_RESULT_UNCERTAIN'});}
  finally{if(lock)try{await lock.release();}catch{/* Lease expiry never permits a second order submission. */}}
 };
}
export default makeManualHandler();
