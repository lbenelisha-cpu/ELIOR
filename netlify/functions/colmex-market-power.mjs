import {brokerMarketError,BrokerMarketReader} from '../../lib/colmex-broker-market.mjs';
import {analyzeCandlePower} from '../../lib/candle-power.mjs';
import {POWER_INTERVALS,powerHistory} from '../../lib/market-power-history.mjs';
import {cachedStockRead} from '../../lib/colmex-market-cache.mjs';
let reader;const pending=new Map();
export const handler=async event=>{
 const reply=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(data)});
 const {symbol,interval='1d'}=event.queryStringParameters||{};
 if(event.httpMethod!=='GET'||!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol||'')||!POWER_INTERVALS[interval])return reply(400,{error:'INVALID_REQUEST'});
 try{
  if(!process.env.COLMEX_API_LOGIN||!process.env.COLMEX_API_PASSWORD)throw Error('MISSING_CREDENTIALS');
  reader??=new BrokerMarketReader({env:process.env});const key=(process.env.COLMEX_AUTO_ACCOUNT_ID||'')+':'+symbol+':'+interval;
  if(!pending.has(key)){const op=cachedStockRead({key:'colmex-power-v1:'+key,freshMs:300000,validate:d=>d?.symbol===symbol&&d?.interval===interval&&d?.analysis?.lookback>0,fetchData:async()=>{
   const {account,id}=await reader.instrument(symbol),p=POWER_INTERVALS[interval],now=Date.now();
   const history=await reader.client.get(`/history?tradableInstrumentId=${id}&accountId=${account}&resolution=${p.resolution}&from=${now-p.days*86400000}&to=${now}&sortOrder=ASC`),bars=powerHistory(history,interval,now);
   if(!bars.length)throw Error('NO_CLOSED_BARS');return {symbol,interval,analysis:analyzeCandlePower(bars),asOf:new Date(now).toISOString(),source:'Colmex Pro'};
  }});pending.set(key,op);op.finally(()=>pending.delete(key)).catch(()=>{});}
  return reply(200,await pending.get(key));
 }catch(error){return reply(503,{...brokerMarketError(error),symbol,interval});}
};
