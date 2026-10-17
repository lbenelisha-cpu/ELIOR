import {cachedStockRead,validStockSnapshot} from '../../lib/colmex-market-cache.mjs';
import {td} from '../../lib/agent.mjs';
const reply=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(data)});
const positive=x=>Number.isFinite(Number(x))&&Number(x)>0;
export function normalizeMarket(series,quote,symbol,interval){
 if(series.meta?.symbol?.toUpperCase()!==symbol||series.meta?.currency!=='USD'||!['Common Stock','ETF'].includes(series.meta?.type))throw Error('UNSUPPORTED_INSTRUMENT');
 const intraday=!['1day','1week','1month'].includes(interval);
 const bars=(series.values||[]).map(b=>({date:intraday?String(b.datetime).replace(' ','T')+'Z':String(b.datetime),open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close)}));
 if(!bars.length||bars.some(b=>!Number.isFinite(Date.parse(b.date))||!['open','high','low','close'].every(k=>positive(b[k]))||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.high<b.low))throw Error('INVALID_MARKET_DATA');
 bars.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));if(new Set(bars.map(b=>b.date)).size!==bars.length)throw Error('DUPLICATE_BARS');
 const q=quote?.symbol?.toUpperCase()===symbol&&quote?.currency==='USD'&&positive(quote?.close)?quote:null;
 const epoch=Number(q?.last_quote_at||q?.timestamp),quoteAt=q&&epoch>0&&epoch*1000<=Date.now()+60000?new Date(epoch*1000).toISOString():null;
 return {symbol,currency:'USD',exchange:series.meta.exchange||null,interval,bars,source:'Twelve Data',price:q?Number(q.close):bars.at(-1).close,priceKind:q?'PROVIDER_QUOTE':'LAST_BAR_CLOSE',priceAt:quoteAt||(q?String(q.datetime||''):bars.at(-1).date),fetchedAt:series.cached_at||null,quoteFetchedAt:q?.cached_at||null,isMarketOpen:typeof q?.is_market_open==='boolean'?q.is_market_open:null,notice:'נתוני ספק חיצוני; ייתכן עיכוב. הנר האחרון עשוי עדיין להתעדכן. לא מחיר ביצוע מקולמקס.'};
}
export async function handler(event){
 if(event.httpMethod!=='GET')return reply(405,{error:'Method not allowed'});
 const symbol=String(event.queryStringParameters?.symbol||'').toUpperCase(),interval=String(event.queryStringParameters?.interval||'1day');
 if(!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)||!['5min','1h','1day','1week','1month'].includes(interval))return reply(400,{error:'סימול או משך נר לא תקינים'});
 try{
  const data=await cachedStockRead({key:'colmex-chart-last:'+symbol+':'+interval+(interval==='5min'?':analysis-v2':''),validate:d=>validStockSnapshot(d,symbol,interval),fetchData:async()=>{
  const [series,quote]=await Promise.allSettled([td('time_series',{symbol,interval,outputsize:interval==='5min'?1000:250,order:'ASC',adjust:'splits',timezone:'UTC'},['1day','1week','1month'].includes(interval)?1800:60),td('quote',{symbol},60)]);
  if(series.status!=='fulfilled')throw Error('SERIES_UNAVAILABLE');
  return normalizeMarket(series.value,quote.status==='fulfilled'?quote.value:null,symbol,interval);
  }});return reply(200,data);
 }catch{return reply(503,{error:'לא ניתן לטעון נתוני שוק כעת. ייתכן שהסימול אינו נתמך או שמכסת הספק נוצלה. נסה שוב או ייבא CSV.'});}
}
