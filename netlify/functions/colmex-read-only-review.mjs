import {runtimeEnvironment} from '../../lib/colmex-auto-policy.mjs';
import {ColmexConnectionControl} from '../../lib/colmex-connection-control.mjs';
import {autoStore,stateKey} from '../../lib/colmex-auto-store.mjs';
import {pendingIntents,validateLiveState} from '../../lib/colmex-live-state.mjs';
import {AutoBroker} from '../../lib/colmex-auto-broker.mjs';
// Same read-only visibility as auto-status: counts and fixed status fields only.
// This handler never reconciles, saves state, resolves an intent or sends an order.
export function makeReadOnlyReview({env=process.env,storeFactory=autoStore,controlFactory=vars=>new ColmexConnectionControl({login:vars.COLMEX_API_LOGIN,password:vars.COLMEX_API_PASSWORD}),brokerFactory=options=>new AutoBroker(options),now=Date.now}={}){
 return async(request,context)=>{
  const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(request.method!=='GET')return reply(405,{ok:false,error:'READ_ONLY'});
  try{
   const vars=runtimeEnvironment(env,context),control=controlFactory(vars),mode=await control.read();
   if(!mode.enabled||!mode.readOnly)return reply(409,{ok:false,error:'DIAGNOSTIC_CONNECTION_REQUIRED'});
   if(!/^\d+$/.test(vars.COLMEX_AUTO_ACCOUNT_ID||''))throw Error('ACCOUNT_NOT_CONFIGURED');
   const record=await storeFactory().get(stateKey(vars.COLMEX_AUTO_ACCOUNT_ID),{type:'json'});
   if(!record?.state)throw Error('STATE_UNAVAILABLE');const s=validateLiveState(record.state);
   const snapshot=await brokerFactory({env:vars,deadline:now()+24000}).snapshot(vars.COLMEX_AUTO_ACCOUNT_ID);
   const latest=await control.read();if(!latest.enabled||!latest.readOnly||latest.revision!==mode.revision)throw Error('CONNECTION_STATE_CHANGED');
   const history=snapshot.history||[],orders=snapshot.orders||[],positions=snapshot.positions||[];
   const pending=pendingIntents(s).map(i=>{
    const matches=[...new Map([...orders,...history].filter(o=>o.id&&(i.orderId?String(o.id)===String(i.orderId):typeof i.tag==='string'&&i.tag.length>0&&o.userComment===i.tag)).map(o=>[String(o.id),o])).values()];
    const related=history.filter(o=>i.order?.tradableInstrumentId&&String(o.tradableInstrumentId)===String(i.order.tradableInstrumentId));
    return {requestId:i.id,symbol:i.symbol,kind:i.kind,matchBy:i.orderId?'ORDER_ID':'COMMENT',matches:matches.length,relatedHistoryCount:related.length,outcome:'REVIEW_REQUIRED',matchedStatuses:matches.map(o=>({status:['filled','cancelled','canceled','rejected','expired','accepted','working','new','partiallyfilled'].includes(String(o.status).toLowerCase())?String(o.status).toLowerCase():'unknown',filledQty:Number.isFinite(Number(o.filledQty))&&o.filledQty!==null&&o.filledQty!==''?Number(o.filledQty):null}))};
   });
   return reply(200,{ok:true,readOnly:true,observedAt:now(),openOrders:orders.length,openPositions:positions.length,historyAvailable:snapshot.historyAvailable===true,historyCount:history.length,pending,changedOrders:false,changedState:false});
  }catch(e){const allowed=['CONNECTION_PAUSED','CONNECTION_STATE_CHANGED','CONNECTION_STATE_UNAVAILABLE','AUTH_DENIED','ACCESS_DENIED','RATE_LIMIT','NETWORK','BROKER_NOT_READY','BROKER_ERROR_RESPONSE','LIVE_ACCOUNT_MISMATCH','STATE_SCHEMA','STATE_VERSION','STATE_UNAVAILABLE','ACCOUNT_NOT_CONFIGURED'];return reply(503,{ok:false,error:allowed.includes(e.code||e.message)?e.code||e.message:'READ_ONLY_REVIEW_UNAVAILABLE'});}
 };
}
export default makeReadOnlyReview();
