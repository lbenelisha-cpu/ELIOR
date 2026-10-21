import {ColmexClient} from './colmex-client-api.mjs';
import {brokerBars} from './colmex-auto-policy.mjs';
import {aggregateStockCandles} from './stock-chart-timeframes.mjs';
export const BROKER_SOURCE='Colmex Pro';
const validId=id=>/^\d+$/.test(String(id));
const dayKey=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
export function brokerChart(history,symbol,interval,now=Date.now()){
 const closed=brokerBars(history,now);if(!closed.length)throw Error('NO_BROKER_BARS');
 const analysisBars=closed.map(b=>({date:new Date(b.openTime).toISOString(),open:b.open,high:b.high,low:b.low,close:b.close,...(Number.isFinite(b.volume)?{volume:b.volume}:{})}));
 let bars=analysisBars;
 if(['10min','15min','1h'].includes(interval))bars=aggregateStockCandles(analysisBars,interval,now);
 else if(interval==='1day'){
  const days=new Map();for(const b of analysisBars){const day=dayKey(b.date),previous=days.get(day);if(!previous)days.set(day,{...b,date:day});else{previous.high=Math.max(previous.high,b.high);previous.low=Math.min(previous.low,b.low);previous.close=b.close;if(Number.isFinite(previous.volume)&&Number.isFinite(b.volume))previous.volume+=b.volume;else delete previous.volume;}}
  bars=[...days.values()];
 }else if(interval!=='5min')throw Error('INVALID_INTERVAL');
 if(!bars.length)throw Error('NO_BROKER_BARS');
 return {symbol,currency:'USD',source:BROKER_SOURCE,interval,bars,analysisBars,price:closed.at(-1).close,priceAt:new Date(closed.at(-1).closeTime).toISOString(),priceKind:'LAST_BAR_CLOSE',observedAt:new Date(now).toISOString(),notice:'נרות מקולמקס־פרו · נרות 5 דקות סגורים בלבד. נרות שעה ויום מאוגדים מההיסטוריה הזמינה; פערים בהיסטוריה עשויים להשפיע על הניתוח. מחיר סגירת הנר אינו מחיר ביצוע.'};
}
export function brokerQuote(q,symbol,now=Date.now()){
 const bid=Number(q?.bp),ask=Number(q?.ap);if(!(bid>0&&ask>0&&Number.isFinite(bid)&&Number.isFinite(ask)&&bid<=ask))throw Error('INVALID_BROKER_QUOTE');
 return {symbol,currency:'USD',source:BROKER_SOURCE,price:bid,bid,ask,priceKind:'BROKER_BID',priceAt:null,observedAt:new Date(now).toISOString(),notice:'מחיר Bid מקולמקס־פרו · שעת קריאה בלבד; הברוקר אינו מספק חותמת זמן לציטוט.'};
}
// This reader exposes only documented GET operations and authentication. No trading adapter.
export class BrokerMarketReader{
 constructor({env,client,now=Date.now}){this.env=env;this.now=now;this.client=client||new ColmexClient({login:env.COLMEX_API_LOGIN,password:env.COLMEX_API_PASSWORD});this.catalog=null;this.catalogAt=0;this.details=new Map();}
 async account(){
  const accounts=await this.client.getAccounts(300000),id=this.env.COLMEX_AUTO_ACCOUNT_ID;
  const account=id?accounts.find(a=>String(a.id)===String(id)):accounts.length===1?accounts[0]:null;
  if(!account||account.currency!=='USD'||!validId(account.id))throw Error('BROKER_ACCOUNT_UNAVAILABLE');return String(account.id);
 }
 async instrument(symbol){
  const account=await this.account();
  if(!this.catalog||this.now()-this.catalogAt>=300000){const data=await this.client.get(`/accounts/${account}/instruments?type=equity,etf`);if(!Array.isArray(data.instruments))throw Error('INSTRUMENT_SCHEMA');this.catalog=data.instruments;this.catalogAt=this.now();}
  const found=this.catalog.filter(i=>i.name===symbol&&['EQUITY','ETF'].includes(i.type));
  if(found.length!==1||!validId(found[0].tradableInstrumentId))throw Error('INSTRUMENT_UNAVAILABLE_OR_AMBIGUOUS');
  const id=String(found[0].tradableInstrumentId),saved=this.details.get(id);
  const details=saved&&this.now()-saved.at<300000?saved.data:await this.client.get(`/instruments/${id}?accountId=${account}`);
  if(details.quotingCurrency!=='USD')throw Error('UNSUPPORTED_CURRENCY');this.details.set(id,{at:this.now(),data:details});return {account,id};
 }
 async chart(symbol,interval){const {account,id}=await this.instrument(symbol),now=this.now();const history=await this.client.get(`/history?tradableInstrumentId=${id}&accountId=${account}&resolution=5m&from=${now-7*86400000}&to=${now}&sortOrder=ASC`);return brokerChart(history,symbol,interval,now);}
 async quote(symbol){const {account,id}=await this.instrument(symbol);return brokerQuote(await this.client.get(`/quotes?tradableInstrumentId=${id}&accountId=${account}`),symbol,this.now());}
}
export function brokerMarketError(error){
 const code=error?.code||error?.message;
 const messages={MISSING_CREDENTIALS:'חיבור נתוני קולמקס אינו מוגדר בשרת.',AUTH_DENIED:'קולמקס דחתה את ההתחברות.',ACCESS_DENIED:'אין הרשאת נתוני שוק למניה זו בקולמקס.',RATE_LIMIT:'ממתין למכסת בקשות פנויה בקולמקס.',NETWORK:'שרת קולמקס לא השיב בזמן.',INSTRUMENT_UNAVAILABLE_OR_AMBIGUOUS:'המניה אינה זמינה או אינה מזוהה באופן חד־משמעי בחשבון קולמקס.',NO_BROKER_BARS:'לא התקבלו נרות תקינים מקולמקס למניה ולטווח שנבחרו.',INVALID_BROKER_QUOTE:'לא התקבל ציטוט Bid/Ask תקין מקולמקס.',BROKER_ACCOUNT_UNAVAILABLE:'חשבון נתוני השוק בקולמקס אינו זמין.',UNSUPPORTED_CURRENCY:'המניה אינה נקובה בדולר בחשבון קולמקס.'};
 return {code:Object.hasOwn(messages,code)?code:'BROKER_DATA_UNAVAILABLE',error:messages[code]||'לא ניתן לטעון נתוני שוק מקולמקס כעת.'};
}
