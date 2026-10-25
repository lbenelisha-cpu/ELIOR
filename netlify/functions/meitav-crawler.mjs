// Dedicated, read-only relay. It never calls the existing Binance/Colmex services.
// No arbitrary destination from the browser; the operator sets one fixed origin.
const COOKIE = '__Secure-meitav_crawler';
const routes = {state:'/api/state', snapshot:'/api/state', schema:'/api/schema', health:'/health', login:'/api/login'};
const tokenPattern = /^\d{9,12}\.[a-f0-9]{64}$/;
const json = (statusCode, body, extra = {}) => ({statusCode, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extra}, body:JSON.stringify(body)});
function baseURL(value) {
  if (!value) return null;
  try { const u = new URL(value); if(u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || !['','/'].includes(u.pathname)) return null; return u.origin; } catch { return null; }
}
export function createHandler({env = process.env, fetcher = fetch} = {}) {
  return async function handler(event) {
    const action = event.queryStringParameters?.action || 'config';
    const method = event.httpMethod;
    const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k,v]) => [k.toLowerCase(),v]));
    const allowed = action === 'logout' || action === 'login' ? 'POST' : 'GET';
    if (!Object.hasOwn(routes,action) && !['config','logout'].includes(action)) return json(404,{error:'נתיב לא נתמך'});
    if (method !== allowed) return json(405,{error:'פעולה לא נתמכת'}, {Allow:allowed});
    if (method === 'POST') {
      let origin;
      try {origin = new URL(headers.origin).host;} catch {return json(403,{error:'נדרשת פנייה מתוך מסך מיטב'});}
      if (origin !== headers.host || !headers.origin.startsWith('https://') || headers['sec-fetch-site'] === 'cross-site') return json(403,{error:'מקור הבקשה אינו מאושר'});
      if (!String(headers['content-type'] || '').startsWith('application/json')) return json(415,{error:'נדרש JSON'});
    }
    const cookie = `${COOKIE}=; Path=/.netlify/functions/meitav-crawler; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
    if(action === 'logout') return json(200,{ok:true},{'Set-Cookie':cookie});
    const base = baseURL(env.CRAWLER_READONLY_URL);
    if(action === 'config') return json(200,{configured:Boolean(base),readOnly:true,protocol:'crypto_crawler',expectedVersion:'2.1.2'});
    if(!base) return json(503,{code:'CRAWLER_NOT_CONFIGURED',error:'שרת הבוט עדיין לא חובר למסך מיטב.'});
    let body;
    let session;
    if(action === 'login') {
      if(event.isBase64Encoded || typeof event.body !== 'string' || event.body.length > 512) return json(400,{error:'בקשת חיבור לא תקינה'});
      try {const data=JSON.parse(event.body);if(typeof data.pin !== 'string' || data.pin.length < 6 || data.pin.length > 128) throw Error();body=JSON.stringify({pin:data.pin});} catch {return json(400,{error:'קוד החיבור צריך להכיל 6 תווים לפחות'});}
    } else {
      session = String(headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
      if(!tokenPattern.test(session || '')) return json(401,{error:'נדרשת כניסה עם קוד הבוט'});
    }
    try {
      const r = await fetcher(base+routes[action], {method,headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...(session?{Cookie:`cc1_session=${session}`}:{})},body,redirect:'error',signal:AbortSignal.timeout(8000)});
      if(!r.headers.get('content-type')?.includes('application/json')) return json(502,{error:'השרת אינו מחזיר נתוני בוט תקינים'});
      const text = await r.text();
      if(text.length > 2_000_000) return json(502,{error:'תשובת השרת גדולה מדי'});
      const data=JSON.parse(text);
      if(action === 'login' && r.ok) {
        const token = r.headers.get('set-cookie')?.match(/(?:^|[,;]\s*)cc1_session=([^;\s,]+)/)?.[1];
        if(!tokenPattern.test(token || '')) return json(502,{error:'השרת לא אישר התחברות'});
        return json(200,{ok:true},{'Set-Cookie':`${COOKIE}=${token}; Path=/.netlify/functions/meitav-crawler; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict`});
      }
      if(!r.ok) {
        if(r.status === 401) return json(401,{error:'הקוד לא התקבל או שהחיבור פג'}, {'Set-Cookie':cookie});
        if(r.status === 429) return json(429,{error:'יותר מדי ניסיונות. יש להמתין חמש דקות.'});
        // Preserve health state, never upstream exceptions/URLs.
        if(action === 'health') return json(503,{ok:false,status:'unavailable',tick_age_s:null});
        return json(502,{error:'לא ניתן לקרוא את נתוני הבוט כרגע'});
      }
      if(action === 'snapshot') {
        let health = {ok:false,status:'unavailable',tick_age_s:null};
        try {
          const h = await fetcher(base+'/health',{headers:{Accept:'application/json',Cookie:`cc1_session=${session}`},redirect:'error',signal:AbortSignal.timeout(4000)});
          if(h.ok && h.headers.get('content-type')?.includes('application/json')) {
            const raw = await h.text();
            if(raw.length < 10_000) {const parsed=JSON.parse(raw);health={ok:parsed.ok === true,status:String(parsed.status || ''),tick_age_s:parsed.tick_age_s};}
          }
        } catch { /* A readable snapshot does not prove the engine is ticking. */ }
        return json(200,{snapshot:data,health});
      }
      return json(200,data);
    } catch {return json(502,{error:'אין חיבור מאומת לשרת הבוט. הנתונים אינם עדכניים.'});}
  };
}
export const handler = createHandler();
