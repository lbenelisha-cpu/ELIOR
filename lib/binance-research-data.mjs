export const DAY=86400000;
export function normalizeCryptoBars(rows){
 if(!Array.isArray(rows)||rows.length<203)throw Error('נדרשים לפחות 203 נרות יומיים סגורים');
 const seen=new Set(),bars=rows.map(r=>{
  const date=String(r.date||''),open=Number(r.open),high=Number(r.high),low=Number(r.low),close=Number(r.close),time=Date.parse(date);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==date||seen.has(date)||![open,high,low,close].every(n=>Number.isFinite(n)&&n>0)||high<Math.max(open,close,low)||low>Math.min(open,close))throw Error('נר לא תקין או תאריך כפול');
  seen.add(date);return {date,open,high,low,close};
 }).sort((a,b)=>a.date.localeCompare(b.date));
 for(let i=1;i<bars.length;i++)if(Date.parse(bars[i].date)-Date.parse(bars[i-1].date)!==DAY)throw Error('חסרים נרות יומיים בסדרה; אין השלמת מחירים מלאכותית');
 return bars;
}
export async function fetchCryptoHistory(symbol,days=730,{fetcher=fetch,now=Date.now()}={}){
 if(!/^[A-Z0-9]{2,16}USDT$/.test(symbol)||! [730,1095,1825].includes(days))throw Error('סימול או אורך היסטוריה לא תקינים');
 let endTime=Math.floor(now/DAY)*DAY-1;const rows=[];
 for(let page=0;page<Math.ceil(days/1000);page++){
  const limit=Math.min(1000,days-rows.length),url=new URL('https://data-api.binance.vision/api/v3/klines');
  for(const [k,v] of Object.entries({symbol,interval:'1d',limit,endTime}))url.searchParams.set(k,String(v));
  const r=await fetcher(url,{signal:AbortSignal.timeout(4000)});
  if(!r.ok){const error=Error(r.status===429||r.status===418?'מכסת נתוני בייננס מוגבלת כרגע; נסה מאוחר יותר':'נתוני בייננס אינם זמינים לסימול הזה');error.status=r.status===429||r.status===418?429:503;throw error;}
  const data=await r.json();if(!Array.isArray(data))throw Error('תשובת נתונים לא תקינה');if(!data.length)break;
  for(const k of data){if(!Array.isArray(k)||k.length<7||!Number.isFinite(Number(k[0]))||!Number.isFinite(Number(k[6]))||Number(k[6])!==Number(k[0])+DAY-1||Number(k[6])>endTime||Number(k[0])%DAY!==0)throw Error('תשובת נרות לא תקינה');rows.push({date:new Date(Number(k[0])).toISOString().slice(0,10),open:k[1],high:k[2],low:k[3],close:k[4]});}
  const first=Math.min(...data.map(k=>Number(k[0])));if(first>endTime)throw Error('שגיאת עימוד');endTime=first-1;
  if(data.length<limit)break;
 }
 const bars=normalizeCryptoBars(rows);if(Date.parse(bars.at(-1).date)+DAY!==Math.floor(now/DAY)*DAY)throw Error('מקור הנתונים לא החזיר את היום האחרון הסגור');
 return {symbol,currency:'USDT',bars,source:'Binance Spot · data-api.binance.vision',interval:'1d',timezone:'UTC',fetchedAt:new Date(now).toISOString(),requestedDays:days};
}
