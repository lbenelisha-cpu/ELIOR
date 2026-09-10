exports.handler = async function(event) {
  const headers = {
    "Content-Type":"application/json; charset=utf-8",
    "Access-Control-Allow-Origin":"*",
    "Netlify-CDN-Cache-Control":"public, durable, max-age=1800",
    "Cache-Control":"public, max-age=300"
  };
  try {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) return {statusCode:500,headers,body:JSON.stringify({error:"ALPHA_VANTAGE_API_KEY is not configured in Netlify."})};
    const allowed = new Set(["SPY","QQQ","DIA","IWM"]);
    const raw = String(event.queryStringParameters?.symbol || "SPY").toUpperCase().trim();
    const symbol = allowed.has(raw) ? raw : "SPY";
    const url = new URL("https://www.alphavantage.co/query");
    url.searchParams.set("function","TIME_SERIES_DAILY");
    url.searchParams.set("symbol",symbol);
    url.searchParams.set("outputsize","compact");
    url.searchParams.set("apikey",apiKey);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Alpha Vantage HTTP ${response.status}`);
    const data = await response.json();
    if (data.Note || data.Information) return {statusCode:429,headers,body:JSON.stringify({error:data.Note || data.Information || "API rate limit reached."})};
    if (data["Error Message"]) return {statusCode:400,headers,body:JSON.stringify({error:data["Error Message"]})};
    const series = data["Time Series (Daily)"];
    if (!series) return {statusCode:502,headers,body:JSON.stringify({error:"No daily market series was returned."})};
    const prices = Object.entries(series).map(([date,row])=>({date,open:Number(row["1. open"]),high:Number(row["2. high"]),low:Number(row["3. low"]),close:Number(row["4. close"]),volume:Number(row["5. volume"])})).filter(x=>Number.isFinite(x.close)).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,100);
    return {statusCode:200,headers,body:JSON.stringify({symbol,lastRefreshed:prices[0]?.date || "",source:"Alpha Vantage TIME_SERIES_DAILY",prices})};
  } catch (err) {
    return {statusCode:500,headers,body:JSON.stringify({error:err.message || "Unexpected server error."})};
  }
};