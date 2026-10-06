import {fetchCryptoHistory} from '../../lib/binance-research-data.mjs';
const cache=new Map(),reply=(statusCode,d)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...(statusCode===429?{'Retry-After':'60'}:{})},body:JSON.stringify(d)});
export async function handler(event){
 if(event.httpMethod!=='GET')return reply(405,{error:'GET only'});
 const symbol=String(event.queryStringParameters?.symbol||'').toUpperCase(),days=Number(event.queryStringParameters?.days||730);
 if(!/^[A-Z0-9]{2,16}USDT$/.test(symbol)||![730,1095,1825].includes(days))return reply(400,{error:'סימול או אורך היסטוריה לא תקינים'});
 const now=Date.now(),key=symbol+':'+days+':'+Math.floor(now/86400000),old=cache.get(key);if(old&&now-old.at<900000)return reply(200,old.data);
 try{const data=await fetchCryptoHistory(symbol,days);if(cache.size>=48)cache.delete(cache.keys().next().value);cache.set(key,{at:now,data});return reply(200,data);}
 catch(error){return reply(error.status||503,{error:error.message||'נתוני בייננס אינם זמינים'});}
}
