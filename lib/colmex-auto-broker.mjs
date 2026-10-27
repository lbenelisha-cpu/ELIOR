import {ColmexClient,mapRow} from './colmex-client-api.mjs';
import {sharedColmexSession} from './colmex-session-store.mjs';
import {BrokerWriteError,isValidationRejection} from './colmex-write-outcome.mjs';
// The public account reader never imports this writer. No arbitrary URLs or retries.
const BASE='https://clientapi.cglms.com/traderevolution/v1';
export class AutoBroker {
 constructor({env,deadline,fetchImpl=fetch,now=Date.now,sessionStore}){this.now=now;this.deadline=deadline;this.fetch=fetchImpl;const options={login:env.COLMEX_API_LOGIN,password:env.COLMEX_API_PASSWORD,now};this.reader=new ColmexClient({...options,sessionStore:sessionStore===undefined?(fetchImpl===fetch?sharedColmexSession(options):null):sessionStore,fetchImpl:(url,options)=>fetchImpl(url,{...options,signal:AbortSignal.timeout(Math.max(1,Math.min(url.includes('/quotes?')?3000:url.includes('/ordersHistory')?5000:12000,deadline-now()-1000)))})});}
 async get(path){if(this.now()>=this.deadline-1000)throw Error('CYCLE_DEADLINE');return this.reader.get(path);}
 async snapshot(id,options={}){
  try{return await this.readSnapshot(id,options);}catch(error){if(error.message!=='SESSION_CHANGED'||this.now()>=this.deadline-7000)throw error;return this.readSnapshot(id,options);}
 }
 async readSnapshot(id,{includeHistory=true}={}){
  await this.reader.authorize();const session=this.reader.session;
  const historyRead=includeHistory?this.get(`/accounts/${id}/ordersHistory`).then(data=>({data,available:true}),()=>({data:{ordersHistory:[]},available:false})):Promise.resolve({data:{ordersHistory:[]},available:true});
  const [config,accounts,state,positions,orders,historyResult]=await Promise.all([...['/config','/accounts',`/accounts/${id}/state`,`/accounts/${id}/positions`,`/accounts/${id}/orders`].map(p=>this.get(p)),historyRead]);
  const history=historyResult.data;
  if(session!==this.reader.session)throw Error('SESSION_CHANGED');
  const account=accounts.accounts?.find(a=>String(a.id)===id);
  if(account?.type!=='live'||account?.currency!=='USD'||account?.status!=='ACTIVE')throw Error('LIVE_ACCOUNT_MISMATCH');
  const rows=(panel,list)=>{if(!Array.isArray(list))throw Error('BROKER_SCHEMA');return list.map(r=>mapRow(panel,r));};
  let historyRows=[],historyAvailable=historyResult.available;
  if(includeHistory&&historyAvailable){try{historyRows=rows(config.ordersHistoryConfig,history.ordersHistory);}catch{historyAvailable=false;}}
  const result={account,state:mapRow(config.accountDetailsConfig,state.accountDetailsData),positions:rows(config.positionsConfig,positions.positions),orders:rows(config.ordersConfig,orders.orders),history:historyRows,historyAvailable};
  // Unknown broker row conventions must never silently bypass exposure limits.
  for(const p of result.positions)if(!p.id||!/^\d+$/.test(String(p.tradableInstrumentId))||!(Number(p.qty)>0)||!['buy','sell'].includes(String(p.side).toLowerCase()))throw Error('POSITION_SCHEMA');
  for(const o of result.orders)if(!o.id||!/^\d+$/.test(String(o.tradableInstrumentId))||!['buy','sell'].includes(String(o.side).toLowerCase()))throw Error('ORDER_SCHEMA');
  return result;
 }
 async instruments(id){return (await this.get(`/accounts/${id}/instruments?type=equity,etf`)).instruments;}
 async details(id,account){return this.get(`/instruments/${id}?accountId=${account}`);}
 async quote(id,account){return this.get(`/quotes?tradableInstrumentId=${id}&accountId=${account}`);}
 async history(id,account){const now=this.now();return this.get(`/history?tradableInstrumentId=${id}&accountId=${account}&resolution=5m&from=${now-7*86400000}&to=${now}&sortOrder=ASC`);}
 async write(account,intent){
  if(this.now()>this.deadline-7500)throw new BrokerWriteError('WRITE_DEADLINE',{outcome:'NOT_SENT'});
  let token;try{token=await this.reader.authorize();}catch{throw new BrokerWriteError('WRITE_AUTH_FAILED',{outcome:'NOT_SENT'});}
  if(this.now()>this.deadline-7500)throw new BrokerWriteError('WRITE_DEADLINE',{outcome:'NOT_SENT'});
  let path,method,body;
  if(intent.kind==='BUY'){path=`/accounts/${account}/orders?requestId=${encodeURIComponent(intent.id)}`;method='POST';body={...intent.order,userComment:intent.tag};}
  else if(intent.kind==='STOP'){path=`/positions/${encodeURIComponent(intent.positionId)}`;method='PATCH';body={stopLoss:intent.stopLoss};}
  else if(intent.kind==='PROTECTION'){path=`/positions/${encodeURIComponent(intent.positionId)}`;method='PATCH';body={stopLoss:intent.stopLoss,takeProfit:intent.takeProfit};}
  else if(intent.kind==='CLOSE'){path=`/positions/${encodeURIComponent(intent.positionId)}`;method='DELETE';body={qty:intent.qty};}
  else throw new BrokerWriteError('WRITE_INVALID_REQUEST',{outcome:'NOT_SENT'});
  // A timeout or malformed response has UNKNOWN outcome: the durable intent must remain.
  let payload;try{payload=JSON.stringify(body);}catch{throw new BrokerWriteError('WRITE_INVALID_REQUEST',{outcome:'NOT_SENT'});}
  let r;try{r=await this.fetch(BASE+path,{method,redirect:'error',signal:AbortSignal.timeout(6000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},body:payload});}
  catch{throw new BrokerWriteError('WRITE_NETWORK_OR_TIMEOUT');}
  const meta={httpStatus:r.status};let data;
  try{data=await r.json();}catch{throw new BrokerWriteError('WRITE_INVALID_RESPONSE',meta);}
  meta.responseStatus=data?.s;
  if(isValidationRejection(r.status,data))throw new BrokerWriteError('WRITE_VALIDATION_REJECTED',{...meta,outcome:'REJECTED'});
  if(!r.ok)throw new BrokerWriteError([401,403].includes(r.status)?'WRITE_ACCESS_DENIED':r.status===429?'WRITE_RATE_LIMIT':'WRITE_HTTP_ERROR',meta);
  if(data?.s!=='ok')throw new BrokerWriteError(data?.s==='error'?'WRITE_BROKER_ERROR':'WRITE_INVALID_RESPONSE',meta);
  if(intent.kind==='BUY'&&!data.d?.orderId)throw new BrokerWriteError('WRITE_ACK_MISSING_ORDER_ID',meta);return data.d||{};
 }
}
