import {td} from "../../lib/agent.mjs";
const headers={
  "Content-Type":"application/json; charset=utf-8",
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"Content-Type",
  "Access-Control-Allow-Methods":"GET,OPTIONS"
};


export const handler=async event=>{
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
      quoteAsOf:quote.cached_at||null,
      dataType:"cached_quote",
      source:"Twelve Data",
      currentPrice:Number.isFinite(current)?current:prices[0]?.close
    })};
  }catch(e){
    console.error("TWELVE_MARKET_ERROR",e?.stack||String(e));
    return{statusCode:500,headers,body:JSON.stringify({error:e.message||"Market data error"})};
  }
};
