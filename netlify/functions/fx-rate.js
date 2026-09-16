import {td} from "../../lib/agent.mjs";
const headers={
  "Content-Type":"application/json; charset=utf-8",
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"Content-Type",
  "Access-Control-Allow-Methods":"GET,OPTIONS"
};
async function tdPrice(symbol){const d=await td('price',{symbol});const price=Number(d.price);if(!Number.isFinite(price)||price<=0)throw Error('Invalid FX');return {rate:price,lastRefreshed:d.cached_at||null};}
export const handler=async event=>{
  if(event.httpMethod==="OPTIONS")return{statusCode:204,headers,body:""};
  try{
    const quote=await tdPrice("USD/ILS");
    return{statusCode:200,headers,body:JSON.stringify({...quote,source:"Twelve Data"})};
  }catch(e){
    console.error("TWELVE_FX_ERROR",e?.stack||String(e));
    return{statusCode:500,headers,body:JSON.stringify({error:e.message||"FX data error"})};
  }
};
