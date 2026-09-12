exports.handler=async event=>{
  const entitlement=String(process.env.ALPHA_VANTAGE_ENTITLEMENT||"").toLowerCase();
  const isLive=entitlement==="realtime"||entitlement==="delayed";
  const h={
    "Content-Type":"application/json; charset=utf-8",
    "Access-Control-Allow-Origin":"*",
    "Netlify-CDN-Cache-Control":isLive?"public, durable, max-age=300":"public, durable, max-age=1800",
    "Cache-Control":isLive?"public,max-age=300":"public,max-age=1800"
  };
  try{
    const key=process.env.ALPHA_VANTAGE_API_KEY;
    if(!key)throw Error("API key is not configured");
    const allowed=new Set(["SPY","QQQ","DIA","IWM"]);
    const raw=String(event.queryStringParameters?.symbol||"SPY").toUpperCase();
    const symbol=allowed.has(raw)?raw:"SPY";
    const u=new URL("https://www.alphavantage.co/query");
    u.searchParams.set("function","TIME_SERIES_DAILY");
    u.searchParams.set("symbol",symbol);
    u.searchParams.set("outputsize","compact");
    if(isLive)u.searchParams.set("entitlement",entitlement);
    u.searchParams.set("apikey",key);
    const r=await fetch(u),d=await r.json();
    if(d.Note||d.Information)return{statusCode:429,headers:h,body:JSON.stringify({error:d.Note||d.Information})};
    const series=d["Time Series (Daily)"];
    if(!series)throw Error(d["Error Message"]||"No market data returned");
    const prices=Object.entries(series)
      .map(([date,x])=>({date,close:+x["4. close"]}))
      .filter(x=>Number.isFinite(x.close))
      .sort((a,b)=>b.date.localeCompare(a.date)).slice(0,100);
    return{statusCode:200,headers:h,body:JSON.stringify({
      symbol,
      lastRefreshed:prices[0]?.date||"",
      prices,
      source:"Alpha Vantage",
      entitlement:isLive?entitlement:"end-of-day",
      freshnessLabel:entitlement==="realtime"?"זמן אמת":entitlement==="delayed"?"עיכוב 15 דק׳":"סגירת יום אחרונה",
      checkedAt:new Date().toISOString()
    })};
  }catch(e){return{statusCode:500,headers:h,body:JSON.stringify({error:e.message})}}
};
