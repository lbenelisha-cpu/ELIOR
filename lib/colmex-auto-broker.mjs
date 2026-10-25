import {ColmexClient,mapRow} from './colmex-client-api.mjs';
// The public account reader never imports this writer. No arbitrary URLs or retries.
const BASE='https://clientapi.cglms.com/traderevolution/v1';
export class AutoBroker {
 constructor({env,deadline,fetchImpl=fetch,now=Date.now}){this.now=now;this.deadline=deadline;this.fetch=fetchImpl;this.reader=new ColmexClient({login:env.COLMEX_API_LOGIN,password:env.COLMEX_API_PASSWORD,now,fetchImpl:(url,options)=>fetchImpl(url,{...options,signal:AbortSignal.timeout(Math.max(1,Math.min(url.includes('/quotes?')?3000:url.includes('/ordersHistory')?5000:12000,deadline-now()-1000)))})});}
 async get(path){if(this.now()>=this.deadline-1000)throw Error('CYCLE_DEADLINE');return this.reader.get(path);}
 async snapshot(id,{includeHistory=true}={}){
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
  if(this.now()>this.deadline-7500)throw Error('WRITE_DEADLINE');
  const token=await this.reader.authorize();
  let path,method,body;
  if(intent.kind==='BUY'){path=`/accounts/${account}/orders?requestId=${encodeURIComponent(intent.id)}`;method='POST';body={...intent.order,userComment:intent.tag};}
  else if(intent.kind==='STOP'){path=`/positions/${encodeURIComponent(intent.positionId)}`;method='PATCH';body={stopLoss:intent.stopLoss};}
  else if(intent.kind==='PROTECTION'){path=`/positions/${encodeURIComponent(intent.positionId)}`;method='PATCH';body={stopLoss:intent.stopLoss,takeProfit:intent.takeProfit};}
  else if(intent.kind==='CLOSE'){path=`/positions/${encodeURIComponent(intent.positionId)}`;method='DELETE';body={qty:intent.qty};}
  else throw Error('UNKNOWN_INTENT');
  // A timeout or malformed response has UNKNOWN outcome: the durable intent must remain.
  const r=await this.fetch(BASE+path,{method,redirect:'error',signal:AbortSignal.timeout(6000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)});
  if(!r.ok)throw Error('WRITE_OUTCOME_REQUIRES_RECONCILIATION');const data=await r.json();if(data.s!=='ok')throw Error('WRITE_OUTCOME_REQUIRES_RECONCILIATION');
  if(intent.kind==='BUY'&&!data.d?.orderId)throw Error('WRITE_OUTCOME_REQUIRES_RECONCILIATION');return data.d||{};
 }
}
