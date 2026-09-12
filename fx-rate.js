const API_KEY=process.env.TWELVE_DATA_API_KEY;
const headers={
  "Content-Type":"application/json; charset=utf-8",
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"Content-Type",
  "Access-Control-Allow-Methods":"GET,OPTIONS"
};
async function tdPrice(symbol){
  if(!API_KEY)throw Error("TWELVE_DATA_API_KEY is missing");
  const u=new URL("https://api.twelvedata.com/price");u.searchParams.set("symbol",symbol);
  const r=await fetch(u,{headers:{Authorization:`apikey ${API_KEY}`}}),d=await r.json().catch(()=>({}));
  if(!r.ok||d?.status==="error"||d?.code>=400)throw Error(d?.message||`Twelve Data HTTP ${r.status}`);
  const price=Number(d?.price);if(!Number.isFinite(price))throw Error("No USD/ILS rate");return price;
}
exports.handler=async event=>{
  if(event.httpMethod==="OPTIONS")return{statusCode:204,headers,body:""};
  try{
    const rate=await tdPrice("USD/ILS");
    return{statusCode:200,headers,body:JSON.stringify({rate,lastRefreshed:new Date().toISOString(),source:"Twelve Data"})};
  }catch(e){
    console.error("TWELVE_FX_ERROR",e?.stack||String(e));
    return{statusCode:500,headers,body:JSON.stringify({error:e.message||"FX data error"})};
  }
};
