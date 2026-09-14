const TK=process.env.TWELVE_DATA_API_KEY;

async function td(endpoint,q={}){
  if(!TK)throw Error("TWELVE_DATA_API_KEY is missing");
  const u=new URL(`https://api.twelvedata.com/${endpoint}`);
  Object.entries(q).forEach(([k,v])=>u.searchParams.set(k,String(v)));
  const r=await fetch(u,{headers:{Authorization:`apikey ${TK}`}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||d?.status==="error"||d?.code>=400)throw Error(d?.message||`Twelve Data HTTP ${r.status}`);
  return d;
}

const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const clamp=x=>Math.max(0,Math.min(100,Math.round(x)));

function scoreBars(values){
  const closes=values.map(v=>Number(v.close)).filter(Number.isFinite);
  if(closes.length<25)return null;
  const last=closes[0];
  const r5=(last/closes[Math.min(5,closes.length-1)]-1)*100;
  const r20=(last/closes[Math.min(20,closes.length-1)]-1)*100;
  const sma10=mean(closes.slice(0,10));
  const sma25=mean(closes.slice(0,25));
  const rs=[];
  for(let i=0;i<Math.min(24,closes.length-1);i++)rs.push(closes[i]/closes[i+1]-1);
  const m=mean(rs);
  const vol=Math.sqrt(mean(rs.map(x=>(x-m)**2)))*100;
  const market=clamp(50+r20*8);
  const trend=clamp(50+(last/sma10-1)*700+(sma10/sma25-1)*500);
  const risk=clamp(82-vol*35);
  const momentum=clamp(50+r5*12+r20*4);
  const master=clamp((market+trend+risk+momentum)/4);
  return {price:last,r5,r20,vol,market,trend,risk,momentum,master};
}

const WATCHLIST=[
  ["SPY","S&P 500"],
  ["QQQ","Nasdaq 100"],
  ["DIA","Dow Jones"],
  ["IWM","Russell 2000"],
  ["XLK","Technology"],
  ["XLF","Financials"],
  ["XLE","Energy"],
  ["XLV","Health Care"]
];

exports.handler=async()=>{
  const headers={
    "Content-Type":"application/json; charset=utf-8",
    "Access-Control-Allow-Origin":"*",
    "Cache-Control":"public,max-age=300",
    "Netlify-CDN-Cache-Control":"public, durable, max-age=1800"
  };
  try{
    const rows=[];
    for(const [symbol,name] of WATCHLIST){
      const d=await td("time_series",{symbol,interval:"30min",outputsize:80,order:"DESC"});
      const values=Array.isArray(d?.values)?d.values:[];
      const s=scoreBars(values);
      if(!s)continue;
      rows.push({
        symbol,name,
        ...s,
        signal:s.master>=70?"חזק":s.master>=60?"חיובי":s.master>=50?"ניטרלי":s.master>=40?"חלש":"זהירות",
        updated_at:String(values[0]?.datetime||"")
      });
    }
    rows.sort((a,b)=>b.master-a.master);
    return {
      statusCode:200,
      headers,
      body:JSON.stringify({
        generated_at:new Date().toISOString(),
        interval:"30min",
        universe:"ETF educational watchlist",
        candidates:rows
      })
    };
  }catch(e){
    return {statusCode:500,headers,body:JSON.stringify({error:String(e?.message||e)})};
  }
};
