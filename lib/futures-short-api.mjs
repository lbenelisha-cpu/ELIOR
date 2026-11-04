import {createHmac} from 'node:crypto';
// Dedicated host and allowlist: this client cannot send a Spot order or a transfer.
const reads=new Set(['/fapi/v1/time','/fapi/v1/exchangeInfo','/fapi/v1/ticker/24hr','/fapi/v1/ticker/bookTicker','/fapi/v1/ticker/price','/fapi/v1/klines','/fapi/v1/premiumIndex','/fapi/v2/account','/fapi/v1/positionSide/dual','/fapi/v1/symbolConfig','/fapi/v1/userTrades','/fapi/v1/openOrders','/fapi/v1/openAlgoOrders','/fapi/v1/order','/fapi/v1/algoOrder','/fapi/v1/income']);
const publicPaths=new Set(['/fapi/v1/time','/fapi/v1/exchangeInfo','/fapi/v1/ticker/24hr','/fapi/v1/ticker/bookTicker','/fapi/v1/ticker/price','/fapi/v1/klines','/fapi/v1/premiumIndex']);
export class FuturesShortAPI{
 constructor({key,secret,fetchImpl=fetch,now=Date.now}){Object.assign(this,{key,secret,fetchImpl,now,offset:0,clockAt:0});}
 async request(method,path,params={}){
  if(method==='GET'?!reads.has(path):method==='POST'?!['/fapi/v1/order','/fapi/v1/algoOrder','/fapi/v1/leverage','/fapi/v1/marginType'].includes(path):method==='DELETE'?path!=='/fapi/v1/algoOrder':true)throw Error('FUTURES_ENDPOINT_FORBIDDEN');
  if(method==='POST'&&path==='/fapi/v1/order'&&!(params.positionSide==='BOTH'&&(params.side==='SELL'&&params.type==='LIMIT'&&params.timeInForce==='IOC'||params.side==='BUY'&&params.type==='MARKET'&&params.reduceOnly==='true')))throw Error('FUTURES_ORDER_FORBIDDEN');
  if(method==='POST'&&path==='/fapi/v1/algoOrder'&&!(params.side==='BUY'&&params.positionSide==='BOTH'&&params.closePosition==='true'&&['STOP_MARKET','TAKE_PROFIT_MARKET'].includes(params.type)))throw Error('FUTURES_PROTECTION_FORBIDDEN');
  if(path==='/fapi/v1/leverage'&&Number(params.leverage)!==1)throw Error('FUTURES_LEVERAGE_FORBIDDEN');
  if(path==='/fapi/v1/marginType'&&params.marginType!=='ISOLATED')throw Error('FUTURES_MARGIN_FORBIDDEN');
  const signed=!publicPaths.has(path);
  if(signed&&(!this.key||!this.secret))throw Error('FUTURES_CREDENTIALS_MISSING');
  if(signed&&this.now()-this.clockAt>30000){
   const start=this.now(),clock=await this.request('GET','/fapi/v1/time');
   if(!Number.isFinite(clock.serverTime))throw Error('FUTURES_CLOCK_INVALID');
   this.offset=clock.serverTime-(start+this.now())/2;this.clockAt=this.now();
  }
  const q=new URLSearchParams(Object.entries(params).map(([k,v])=>[k,String(v)]));
  if(signed){q.set('timestamp',String(Math.round(this.now()+this.offset)));q.set('recvWindow','5000');q.set('signature',createHmac('sha256',this.secret).update(q.toString()).digest('hex'));}
  let r,data;
  try{r=await this.fetchImpl('https://fapi.binance.com'+path+'?'+q,{method,headers:signed?{'X-MBX-APIKEY':this.key}:{},redirect:'error',signal:AbortSignal.timeout(8000)});data=await r.json();}
  catch{throw Error('FUTURES_NETWORK_OUTCOME_UNKNOWN');}
  if(!r.ok||Number(data.code)<0){const e=Error('FUTURES_API_'+(Number.isInteger(data.code)?data.code:r.status));e.code=data.code;e.status=r.status;throw e;}
  return data;
 }
 get(path,p){return this.request('GET',path,p);}
 post(path,p){return this.request('POST',path,p);}
 del(path,p){return this.request('DELETE',path,p);}
}
