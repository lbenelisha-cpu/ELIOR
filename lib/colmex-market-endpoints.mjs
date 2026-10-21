import {createHash} from 'node:crypto';
import {BrokerMarketReader,BROKER_SOURCE,brokerMarketError} from './colmex-broker-market.mjs';
import {cachedStockRead,validStockSnapshot} from './colmex-market-cache.mjs';
const reply=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(data)});
export function makeBrokerMarketHandler(kind,{env=()=>process.env,readerFactory=options=>new BrokerMarketReader(options),cacheRead=cachedStockRead}={}){
 let reader,key;const pending=new Map();
 return async event=>{
  if(event.httpMethod!=='GET')return reply(405,{error:'קריאת נתוני שוק בלבד'});
  const q=event.queryStringParameters||{},symbol=String(q.symbol||'').toUpperCase(),interval=String(q.interval||'1day');
  if(Object.keys(q).some(k=>!['symbol',...(kind==='chart'?['interval']:[])].includes(k))||!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)||kind==='chart'&&!['5min','10min','15min','1h','1day'].includes(interval))return reply(400,{error:'סימול או משך נר לא תקינים'});
  try{
   const vars=env();if(!vars.COLMEX_API_LOGIN||!vars.COLMEX_API_PASSWORD)throw Error('MISSING_CREDENTIALS');
   const signature=createHash('sha256').update(vars.COLMEX_API_LOGIN+'\0'+vars.COLMEX_API_PASSWORD+'\0'+(vars.COLMEX_AUTO_ACCOUNT_ID||'')).digest('hex');
   if(!reader||key!==signature){reader=readerFactory({env:vars});key=signature;}
   const current=reader,account=await current.account(),requestKey=[kind,account,symbol,kind==='chart'?interval:'quote'].join(':');
   if(!pending.has(requestKey)){
    const operation=cacheRead({key:'colmex-broker-market-v1:'+requestKey,freshMs:kind==='chart'?55000:30000,validate:data=>validStockSnapshot(data,symbol,kind==='chart'?interval:null,BROKER_SOURCE),fetchData:()=>kind==='chart'?current.chart(symbol,interval):current.quote(symbol)});
    pending.set(requestKey,operation);operation.finally(()=>{if(pending.get(requestKey)===operation)pending.delete(requestKey);}).catch(()=>{});
   }
   return reply(200,await pending.get(requestKey));
  }catch(error){return reply(503,{source:BROKER_SOURCE,retryAfterSeconds:65,...brokerMarketError(error)});}
 };
}
