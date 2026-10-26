import {colmexSettingsRecord} from '../../lib/trade-settings.mjs';
import {hasPending,pendingIntents,validateLiveState} from '../../lib/colmex-live-state.mjs';
import {AUTO_POLICY,LIVE_ACK,configuredLive,runtimeEnvironment} from '../../lib/colmex-auto-policy.mjs';
import {autoStore,stateKey} from '../../lib/colmex-auto-store.mjs';
export function makeHandler({env=process.env,storeFactory=autoStore}={}){return async event=>{
 const response=(code,data)=>({statusCode:code,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(data)});
 if(event.httpMethod!=='GET')return response(405,{error:'READ_ONLY'});
 const enabled=configuredLive(env),base={policy:AUTO_POLICY,enabled,activation:'SERVER_CONFIGURATION_ONLY',live:true,configuration:{accountPinned:/^\d+$/.test(env.COLMEX_AUTO_ACCOUNT_ID||''),liveAckMatches:env.COLMEX_AUTO_LIVE_ACK===LIVE_ACK,enabledFlag:env.COLMEX_AUTO_LIVE_ENABLED==='true',productionEnvironment:env.CONTEXT==='production'}};
 try{
  const id=env.COLMEX_AUTO_ACCOUNT_ID;
  const value=/^\d+$/.test(id||'')?await storeFactory().get(stateKey(id),{type:'json'}):null,s=value?.state;
  if(value)validateLiveState(s);
  const settings=colmexSettingsRecord(s).values;
  return response(200,{...base,policy:{...AUTO_POLICY,...settings,profitFloorPct:settings.profitActivationPct-settings.trailingGapPp},status:!enabled?'DISABLED':s?.halt?'REQUIRES_REVIEW':s&&hasPending(s)?'PENDING_BROKER_CONFIRMATION':s?.lastError?'CYCLE_ERROR':s?.lastCycleAt?'MONITORING':'WAITING_FIRST_CYCLE',lastCycleAt:s?.lastCycleAt??null,decisionAudit:s?.maAudit?{lastPersistedAt:s.maAudit.lastPersistedAt||null,pending:s.maAudit.rows?.length||0,error:s.maAudit.error||null,dropped:s.maAudit.dropped||0}:null,lastCompletedAt:s?.lastCompletedAt??null,lastResult:s?.lastResult??null,halt:s?.halt??null,pending:s?.pending?{kind:s.pending.kind,symbol:s.pending.symbol,at:s.pending.at}:null,pendingActions:s?pendingIntents(s).map(i=>({kind:i.kind,symbol:i.symbol,at:i.at,reviewRequired:!!i.reviewRequired})):[],lastBrokerSnapshotAt:s?.lastBrokerSnapshotAt??null,closedTrades:s?.closedTrades?.slice(-100)||[],positions:s?.positions?.map(p=>({symbol:p.symbol,brokerProtection:p.brokerProtection||null,riskStatus:p.riskStatus||null,lastRiskCheckAt:p.lastRiskCheckAt||null,lastBid:p.lastBid||null,lastQuoteAt:p.lastQuoteAt||null,qty:p.qty,entryPrice:p.entryPrice,peakPrice:p.peakPrice,entryAt:p.entryAt,effectiveStopPrice:p.effectiveStopPrice,exitPolicy:p.exitPolicy,profitFloorArmed:p.profitFloorArmed,activationPrice:p.activationPrice,trailingGapPp:p.trailingGapPp,protectedGainPct:p.protectedGainPct,targetPrice:p.targetPrice,takeProfitPct:p.takeProfitPct,stopLossPct:p.stopLossPct,profitActivationPct:p.profitActivationPct,stopPrice:p.stopPrice,entryMode:p.entryMode||p.setup?.entryMode||'spring_rsi_live',setup:p.setup}))||[],preparation:s?.preparation||null,after:s?.after||{},checks:s?.checks||{},historyQuality:s?.historyQuality||null,events:s?.events?.slice(-30)||[],lastError:s?.lastError||null});
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
