export const WATCHLIST = ['SPY','QQQ','DIA','IWM','AAPL','MSFT','NVDA','AMZN'];
export async function db(path, options={}) {
  const base=(process.env.SUPABASE_URL||'').trim().replace(/\/+$/,'').replace(/\/rest\/v1$/i,'');
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base||!key) throw Error('Supabase environment variables are missing');
  const r=await fetch(`${base}/rest/v1/${path}`,{...options,signal:AbortSignal.timeout(4000),headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Prefer:'return=representation',...options.headers}});
  const d=await r.json(); if(!r.ok) throw Error(d.message||`Supabase HTTP ${r.status}`); return d;
}
async function rawTd(endpoint, params) {
  const key=process.env.TWELVE_DATA_API_KEY;
  if(!key) throw Error('TWELVE_DATA_API_KEY is missing');
  const u=new URL(`https://api.twelvedata.com/${endpoint}`);
  for(const [k,v] of Object.entries(params)) u.searchParams.set(k,v);
  const r=await fetch(u,{signal:AbortSignal.timeout(6000),headers:{Authorization:`apikey ${key}`}});
  const d=await r.json(); if(!r.ok||d.status==='error'||d.code>=400) throw Error(d.message||`Twelve Data HTTP ${r.status}`); return d;
}
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const clamp=x=>Math.max(0,Math.min(100,Math.round(x)));
export function score(values) {
  const c=values.map(x=>Number(x.close));
  if(c.length<25||c.some(x=>!Number.isFinite(x)||x<=0)) throw Error('Insufficient or invalid market bars');
  const price=c[0],r5=(price/c[5]-1)*100,r20=(price/c[20]-1)*100;
  const s10=mean(c.slice(0,10)),s25=mean(c.slice(0,25));
  const rs=c.slice(0,24).map((x,i)=>x/c[i+1]-1),m=mean(rs),vol=Math.sqrt(mean(rs.map(x=>(x-m)**2)))*100;
  const market=clamp(50+r20*8),trend=clamp(50+(price/s10-1)*700+(s10/s25-1)*500),risk=clamp(82-vol*35),momentum=clamp(50+r5*12+r20*4);
  const master=clamp((market+trend+risk+momentum)/4);
  return {price,market,trend,risk,momentum,master,signal:master>=60?'מועמד לקנייה':master<40?'מועמד למכירה':'המתנה'};
}
export function target(s){return s>=70?.8:s>=60?.65:s>=50?.5:s>=40?.25:0;}
export function marketOpen(now=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  const minute=Number(parts.hour)*60+Number(parts.minute);
  return !['Sat','Sun'].includes(parts.weekday)&&minute>=570&&minute<960;
}
export function slot(now=new Date()){return new Date(Math.floor(+now/1800000)*1800000).toISOString();}
export function fresh(datetime,now=Date.now()) {
  const t=Date.parse(String(datetime).replace(' ','T')+'Z');
  return Number.isFinite(t)&&now-t>=0&&now-t<=45*60000;
}
export async function bars(symbol){
  const data=await td('time_series',{symbol,interval:'30min',outputsize:80,order:'DESC',timezone:'UTC'});
  const values=data.values||[]; return {...score(values),updated_at:values[0].datetime};
}

export async function td(endpoint,params={}) {
 const key=endpoint+':'+JSON.stringify(Object.entries(params).sort(([a],[b])=>a.localeCompare(b)))+':'+slot();
 const reserved=await db('rpc/paper_market_reserve',{method:'POST',body:JSON.stringify({p_key:key})});
 if(reserved.state==='cached')return reserved.payload;
 if(reserved.state!=='fetch')throw Error('ממתין למכסת נתונים — ניסיון נוסף בהרצת הסוכן הבאה');
 try {
  const payload={...await rawTd(endpoint,params),cached_at:new Date().toISOString()};
  await db('paper_market_cache?on_conflict=key',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({key,payload,expires_at:new Date(Date.parse(slot())+1800000).toISOString(),lease_until:null})});
  return payload;
 }catch(e){
  await db('paper_market_cache?key=eq.'+encodeURIComponent(key),{method:'PATCH',body:JSON.stringify({lease_until:null})}).catch(()=>{});
  throw e;
 }
}

export function alignSeries(series,now=Date.now()){
 const entries=Object.entries(series);
 if(!entries.length)throw Error('אין סדרות נתונים');
 const ordered=entries.map(([symbol,data])=>[symbol,[...(data.values||[])].sort((a,b)=>String(b.datetime).localeCompare(String(a.datetime)))]);
 const common=ordered[0][1].find(bar=>fresh(bar.datetime,now)&&ordered.every(([,rows])=>{const i=rows.findIndex(x=>x.datetime===bar.datetime);return i>=0&&rows.length-i>=25;}));
 if(!common)throw Error('ממתין לנתונים מסונכרנים ועדכניים לכל המניות');
 return Object.fromEntries(ordered.map(([symbol,rows])=>{const i=rows.findIndex(x=>x.datetime===common.datetime);return [symbol,{...score(rows.slice(i)),updated_at:common.datetime}];}));
}
export async function barSeries(symbol){return td('time_series',{symbol,interval:'30min',outputsize:80,order:'DESC',timezone:'UTC'});}
