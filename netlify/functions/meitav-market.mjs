import {td} from '../../lib/agent.mjs';
import {normalizeBars} from '../../lib/meitav-paper.mjs';
const reply=(statusCode,d)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(d)});
export async function handler(event){
 if(event.httpMethod!=='GET')return reply(405,{error:'Method not allowed'});
 const symbol=String(event.queryStringParameters?.symbol||'').toUpperCase();
 if(!/^[A-Z][A-Z0-9.\-]{0,11}$/.test(symbol))return reply(400,{error:'סימול מניה לא תקין'});
 try{
  const data=await td('time_series',{symbol,interval:'1day',outputsize:800,order:'ASC',adjust:'splits'});
  if(!['Common Stock','ETF'].includes(data.meta?.type))return reply(422,{error:'מקור הנתונים אינו מניה רגילה או ETF'});
  const currency=data.meta?.currency;if(!['USD','ILS'].includes(currency))return reply(422,{error:'מטבע הנתונים אינו USD או ILS'});
  const timeZone=data.meta?.exchange_timezone;if(!timeZone)throw Error('Missing exchange timezone');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
  const today=parts.year+'-'+parts.month+'-'+parts.day;
  const bars=normalizeBars((data.values||[]).filter(b=>String(b.datetime).slice(0,10)<today));
  return reply(200,{symbol,currency,bars,source:'Twelve Data',asOf:data.cached_at||null,lastClosedDate:bars.at(-1).date,exchange:data.meta.exchange,priceBasis:'סגירה יומית מאושרת; היום הנוכחי מוחרג'});
 }catch{return reply(503,{error:'נתוני מניות אינם זמינים כרגע. בדוק את הגדרת Twelve Data ומכסת הנתונים, או ייבא CSV.'});}
}
