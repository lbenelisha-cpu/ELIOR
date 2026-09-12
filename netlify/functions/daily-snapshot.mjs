const RAW=process.env.SUPABASE_URL||"";
const SB=RAW.trim().replace(/\/+$/,"").replace(/\/rest\/v1$/i,"");
const SK=process.env.SUPABASE_SERVICE_ROLE_KEY, AK=process.env.ALPHA_VANTAGE_API_KEY;
const H=()=>({apikey:SK,Authorization:`Bearer ${SK}`,"Content-Type":"application/json",Prefer:"return=representation"});
async function db(p,o={}){const r=await fetch(`${SB}/rest/v1/${p}`,{...o,headers:{...H(),...(o.headers||{})}}),t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d={raw:t}}if(!r.ok)throw Error(d?.message||`Supabase ${r.status}`);return d}
async function av(q){const u=new URL("https://www.alphavantage.co/query");Object.entries({...q,apikey:AK}).forEach(([k,v])=>u.searchParams.set(k,v));const d=await (await fetch(u)).json();if(d.Note||d.Information||d["Error Message"])throw Error(d.Note||d.Information||d["Error Message"]);return d}
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length,clamp=x=>Math.max(0,Math.min(100,Math.round(x)));
function calc(pr){const c=pr.map(x=>x.close),last=c[0],r5=(last/c[Math.min(5,c.length-1)]-1)*100,r20=(last/c[Math.min(20,c.length-1)]-1)*100,r60=(last/c[Math.min(60,c.length-1)]-1)*100,s20=mean(c.slice(0,20)),s60=mean(c.slice(0,60)),rs=[];for(let i=0;i<c.length-1;i++)rs.push(c[i]/c[i+1]-1);const m=mean(rs),vol=Math.sqrt(mean(rs.map(x=>(x-m)**2)))*Math.sqrt(252)*100,marketS=clamp(50+r60*2),trend=clamp(50+(last/s20-1)*500+(s20/s60-1)*400),risk=clamp(90-vol*2.2),mom=clamp(50+r5*3+r20*1.5),master=clamp((marketS+trend+risk+mom)/4);return{last,marketS,trend,risk,mom,master,signal:master>=70?"חיובי":master>=55?"חיובי מתון":master>=45?"ניטרלי":master>=30?"זהירות":"שלילי"}}
export default async()=>{try{
 const rows=await db("paper_portfolio?select=*&status=eq.open&order=updated_at.asc");if(!rows?.length){console.log("DAILY_SNAPSHOT no open portfolios");return}
 const fd=await av({function:"CURRENCY_EXCHANGE_RATE",from_currency:"USD",to_currency:"ILS"}),fx=+fd["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"];if(!fx)throw Error("No USD/ILS rate");
 const data=[];
 for(const p of rows){
   await new Promise(r=>setTimeout(r,1300));
   const md=await av({function:"TIME_SERIES_DAILY",symbol:p.symbol,outputsize:"compact"}),series=md["Time Series (Daily)"];if(!series)throw Error("No daily market series for "+p.symbol);
   const dates=Object.keys(series).sort().reverse(),pr=dates.slice(0,100).map(date=>({date,close:+series[date]["4. close"]})),latest=pr[0],a=calc(pr);
   data.push({p,latest,a,positionValue:(+p.units)*a.last*fx});
 }
 const cap=Math.max(...rows.map(p=>+p.start||0),100000),used=rows.reduce((n,p)=>n+(+p.allocated_ils||0),0),cash=Math.max(0,cap-used),total=cash+data.reduce((n,x)=>n+x.positionValue,0),totalPnl=total-cap;
 for(const x of data){const {p,latest,a,positionValue}=x,key=`${p.id}-${p.symbol}-${latest.date}`,ex=await db(`portfolio_snapshots?select=id&snapshot_key=eq.${encodeURIComponent(key)}&limit=1`);if(ex?.length){console.log("DAILY_SNAPSHOT already exists",key);continue}
   const positionPnl=positionValue-(+p.allocated_ils);
   await db("portfolio_snapshots",{method:"POST",body:JSON.stringify({snapshot_key:key,date:latest.date,symbol:p.symbol,position_id:String(p.id),position_value:positionValue,position_pnl:positionPnl,value:total,pnl:totalPnl,fx,score:a.master,market_price:a.last,auto:true,market_score:a.marketS,trend_score:a.trend,risk_score:a.risk,momentum_score:a.mom,recommendation:a.signal,plan:(p.strategy_mode||p.plan)||null})});
   console.log("DAILY_SNAPSHOT saved",key);
 }
}catch(e){console.error("DAILY_SNAPSHOT_ERROR",e?.stack||String(e));throw e}};
export const config={schedule:"30 22 * * 1-5"};
