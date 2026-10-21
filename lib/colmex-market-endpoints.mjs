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
   // The pinned server account safely scopes cached public market data even during broker outages.
   // A provider fetch still validates membership and currency in reader.instrument().
   const current=reader,account=/^\d+$/.test(vars.COLMEX_AUTO_ACCOUNT_ID||'')?String(vars.COLMEX_AUTO_ACCOUNT_ID):await current.account(),requestKey=[kind,account,symbol,kind==='chart'?interval:'quote'].join(':');
   if(!pending.has(requestKey)){
    const operation=cacheRead({key:(kind==='chart'?'colmex-broker-market-v2:':'colmex-broker-market-v1:')+requestKey,freshMs:kind==='chart'?55000:30000,validate:data=>validStockSnapshot(data,symbol,kind==='chart'?interval:null,BROKER_SOURCE),fetchData:()=>kind==='chart'?current.chart(symbol,interval):current.quote(symbol)});
    pending.set(requestKey,operation);operation.finally(()=>{if(pending.get(requestKey)===operation)pending.delete(requestKey);}).catch(()=>{});
   }
   return reply(200,await pending.get(requestKey));
  }catch(error){return reply(503,{source:BROKER_SOURCE,retryAfterSeconds:65,...brokerMarketError(error)});}
 };
}
// One public market endpoint shares a warm authenticated reader for charts and quotes.
export function makeBrokerMarketService(options={}){
 let shared=null,signature='';const factory=options.readerFactory||((args)=>new BrokerMarketReader(args));
 const readerFactory=args=>{const next=createHash('sha256').update(args.env.COLMEX_API_LOGIN+'\0'+args.env.COLMEX_API_PASSWORD+'\0'+(args.env.COLMEX_AUTO_ACCOUNT_ID||'')).digest('hex');if(!shared||signature!==next){shared=factory(args);signature=next;}return shared;};
 const chart=makeBrokerMarketHandler('chart',{...options,readerFactory}),quote=makeBrokerMarketHandler('quote',{...options,readerFactory});
 return event=>{
  const {view,...query}=event.queryStringParameters||{};
  if(view!==undefined&&view!=='quote')return Promise.resolve(reply(400,{error:'בקשת נתונים לא תקינה'}));
  return (view==='quote'?quote:chart)({...event,queryStringParameters:query});
 };
}
