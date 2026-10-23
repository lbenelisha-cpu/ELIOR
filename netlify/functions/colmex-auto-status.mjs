import {AUTO_POLICY,LIVE_ACK,configuredLive,runtimeEnvironment} from '../../lib/colmex-auto-policy.mjs';
import {autoStore,stateKey} from '../../lib/colmex-auto-store.mjs';
export function makeHandler({env=process.env,storeFactory=autoStore}={}){return async event=>{
 const response=(code,data)=>({statusCode:code,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(data)});
 if(event.httpMethod!=='GET')return response(405,{error:'READ_ONLY'});
 const enabled=configuredLive(env),base={policy:AUTO_POLICY,enabled,activation:'SERVER_CONFIGURATION_ONLY',live:true,configuration:{accountPinned:/^\d+$/.test(env.COLMEX_AUTO_ACCOUNT_ID||''),liveAckMatches:env.COLMEX_AUTO_LIVE_ACK===LIVE_ACK,enabledFlag:env.COLMEX_AUTO_LIVE_ENABLED==='true',productionEnvironment:env.CONTEXT==='production'}};
 try{
  const id=env.COLMEX_AUTO_ACCOUNT_ID;
  const value=/^\d+$/.test(id||'')?await storeFactory().get(stateKey(id),{type:'json'}):null,s=value?.state;
  return response(200,{...base,status:!enabled?'DISABLED':s?.halt?'REQUIRES_REVIEW':s?.pending?'PENDING_BROKER_CONFIRMATION':s?.lastError?'CYCLE_ERROR':s?.lastCycleAt?'MONITORING':'WAITING_FIRST_CYCLE',lastCycleAt:s?.lastCycleAt??null,lastCompletedAt:s?.lastCompletedAt??null,lastResult:s?.lastResult??null,halt:s?.halt??null,pending:s?.pending?{kind:s.pending.kind,symbol:s.pending.symbol,at:s.pending.at}:null,positions:s?.positions?.map(p=>({symbol:p.symbol,qty:p.qty,entryPrice:p.entryPrice,peakPrice:p.peakPrice,entryAt:p.entryAt,effectiveStopPrice:p.effectiveStopPrice,exitPolicy:p.exitPolicy,targetPrice:p.targetPrice,stopPrice:p.stopPrice,setup:p.setup}))||[],after:s?.after||{},checks:s?.checks||{},historyQuality:s?.historyQuality||null,events:s?.events?.slice(-30)||[],lastError:s?.lastError||null});
 }catch{return response(503,{...base,status:'STATUS_UNAVAILABLE'});}
};}
// Fetch-style functions receive the native Blobs context automatically.
export function makeFetchHandler(options={}){return async function(request,context){
 const handler=makeHandler({...options,env:runtimeEnvironment(options.env||process.env,context)});
 const result=await handler({httpMethod:request.method});
 const data=JSON.parse(result.body);data.runtimeDeployContext=context?.deploy?.context??null;
 return new Response(JSON.stringify(data),{status:result.statusCode,headers:result.headers});
};}
export default makeFetchHandler();
