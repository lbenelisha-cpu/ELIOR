const UPSTREAM='https://levi-binance.2-29-48-20.sslip.io';
const READ_PATHS=new Set(['/api/binance-mode','/api/binance-agent','/api/binance-live-account','/api/binance-action-log','/api/binance-chart','/api/binance-decision-history','/api/binance-market-watch','/api/binance-kelly','/api/binance-demo-account']);
export const readTimeoutMs=path=>['/api/binance-chart','/api/binance-live-account'].includes(path)?25000:10000;
const reply=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(data)});
export function readTarget(path){
 if(typeof path!=='string'||path.length>2048||!path.startsWith('/api/'))throw Error('INVALID_PATH');
 const url=new URL(path,UPSTREAM);
 if(url.origin!==UPSTREAM||url.hash||!READ_PATHS.has(url.pathname))throw Error('INVALID_PATH');
 const allowed=new Set(url.pathname==='/api/binance-chart'?['symbol','interval','range']:url.pathname==='/api/binance-decision-history'?['symbol','limit']:[]);
 for(const key of url.searchParams.keys())if(!allowed.has(key))throw Error('INVALID_QUERY');
 return url;
}
export function createReadProxy(fetcher=fetch){return async event=>{
 if(event.httpMethod!=='GET')return reply(405,{error:'קריאת נתונים בלבד'});
 let target;try{target=readTarget(event.queryStringParameters?.path);}catch{return reply(400,{error:'נתיב קריאה לא תקין'});}
 try{
  const r=await fetcher(target,{method:'GET',headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(readTimeoutMs(target.pathname))});
  const contentType=r.headers.get('content-type')||'';
  if(!contentType.includes('application/json'))return reply(502,{error:'שרת הנתונים החזיר תשובה לא תקינה'});
  const data=await r.json();return reply(r.status,data);
 }catch{return reply(504,{error:'לא ניתן לקרוא נתונים מהשרת דרך האתר כרגע. ניסיון נוסף יתבצע אוטומטית.'});}
};}
export const handler=createReadProxy();
