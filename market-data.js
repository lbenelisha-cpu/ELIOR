const API_KEY=process.env.TWELVE_DATA_API_KEY;

const headers={
  "Content-Type":"application/json; charset=utf-8",
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"Content-Type",
  "Access-Control-Allow-Methods":"GET,OPTIONS"
};

async function td(endpoint,params={}){
  if(!API_KEY) throw Error("TWELVE_DATA_API_KEY is missing");
  const u=new URL(`https://api.twelvedata.com/${endpoint}`);
  Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,String(v)));
  const r=await fetch(u,{headers:{Authorization:`apikey ${API_KEY}`}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||d?.status==="error"||d?.code>=400) throw Error(d?.message||`Twelve Data HTTP ${r.status}`);
  return d;
}

exports.handler=async event=>{
  if(event.httpMethod==="OPTIONS")return{statusCode:204,headers,body:""};
  try{
    const symbol=String(event.queryStringParameters?.symbol||"SPY").toUpperCase();
    if(!/^[A-Z.\-]{1,12}$/.test(symbol))return{statusCode:400,headers,body:JSON.stringify({error:"Invalid symbol"})};

    // Keep 100 daily bars for the existing Market/Trend/Risk/Momentum model.
    // Add a current Twelve Data price so the first bar reacts during the session.
    const [series,quote]=await Promise.all([
      td("time_series",{symbol,interval:"1day",outputsize:100,order:"DESC"}),
      td("price",{symbol})
    ]);

    const values=Array.isArray(series?.values)?series.values:[];
    if(values.length<20)throw Error(`No daily market series for ${symbol}`);
    const current=Number(quote?.price);
    const prices=values.map(v=>({date:v.datetime,close:Number(v.close)})).filter(x=>Number.isFinite(x.close));
    if(Number.isFinite(current)&&prices.length)prices[0]={...prices[0],close:current};

    const marketDate=String(values[0]?.datetime||new Date().toISOString().slice(0,10)).slice(0,10);
    return{statusCode:200,headers,body:JSON.stringify({
      symbol,
      prices,
      lastRefreshed:marketDate,
      quoteAsOf:new Date().toISOString(),
      dataType:"realtime_quote",
      source:"Twelve Data",
      currentPrice:Number.isFinite(current)?current:prices[0]?.close
    })};
  }catch(e){
    console.error("TWELVE_MARKET_ERROR",e?.stack||String(e));
    return{statusCode:500,headers,body:JSON.stringify({error:e.message||"Market data error"})};
  }
};
