import {makeBrokerMarketHandler} from '../../lib/colmex-market-endpoints.mjs';
import {colmexFetchHandler} from '../../lib/colmex-function-adapter.mjs';
const reply=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(data)});
export function normalizeStockQuote(q,symbol,now=Date.now()){
 if(q?.symbol?.toUpperCase()!==symbol||q.currency!=='USD'||!(Number(q.close)>0)||!Number.isFinite(Number(q.close))||(q.type&&!['Common Stock','ETF'].includes(q.type)))throw Error('UNSUPPORTED_QUOTE');
 const epoch=Number(q.last_quote_at||q.timestamp),priceAt=epoch>0&&epoch*1000<=now+60000?new Date(epoch*1000).toISOString():/^\d{4}-\d{2}-\d{2}$/.test(q.datetime||'')?q.datetime:null;
 return {symbol,price:Number(q.close),priceAt,priceKind:'PROVIDER_QUOTE',currency:'USD',source:'Twelve Data',fetchedAt:q.cached_at||null};
}
export const readHandler=makeBrokerMarketHandler('quote');
export default colmexFetchHandler(readHandler);
