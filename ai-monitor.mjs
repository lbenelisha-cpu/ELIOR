const RAW=process.env.SUPABASE_URL||"";
const SB=RAW.trim().replace(/\/+$/,"" ).replace(/\/rest\/v1$/i,"");
const SK=process.env.SUPABASE_SERVICE_ROLE_KEY;
const TK=process.env.TWELVE_DATA_API_KEY;
const H=()=>({apikey:SK,Authorization:`Bearer ${SK}`,"Content-Type":"application/json",Prefer:"return=representation"});
async function db(p,o={}){const r=await fetch(`${SB}/rest/v1/${p}`,{...o,headers:{...H(),...(o.headers||{})}}),t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d={raw:t}}if(!r.ok)throw Error(d?.message||`Supabase ${r.status}`);return d}
async function td(endpoint,q={}){if(!TK)throw Error("TWELVE_DATA_API_KEY is missing");const u=new URL(`https://api.twelvedata.com/${endpoint}`);Object.entries(q).forEach(([k,v])=>u.searchParams.set(k,String(v)));const r=await fetch(u,{headers:{Authorization:`apikey ${TK}`}}),d=await r.json().catch(()=>({}));if(!r.ok||d?.status==="error"||d?.code>=400)throw Error(d?.message||`Twelve Data HTTP ${r.status}`);return d}
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length,clamp=x=>Math.max(0,Math.min(100,Math.round(x)));
function calc(pr){const c=pr.map(x=>x.close),last=c[0],r5=(last/c[Math.min(5,c.length-1)]-1)*100,r20=(last/c[Math.min(20,c.length-1)]-1)*100,r60=(last/c[Math.min(60,c.length-1)]-1)*100,s20=mean(c.slice(0,20)),s60=mean(c.slice(0,60)),rs=[];for(let i=0;i<c.length-1;i++)rs.push(c[i]/c[i+1]-1);const m=mean(rs),vol=Math.sqrt(mean(rs.map(x=>(x-m)**2)))*Math.sqrt(252)*100,marketS=clamp(50+r60*2),trend=clamp(50+(last/s20-1)*500+(s20/s60-1)*400),risk=clamp(90-vol*2.2),mom=clamp(50+r5*3+r20*1.5),master=clamp((marketS+trend+risk+mom)/4);return{last,marketS,trend,risk,mom,master,signal:master>=70?"חיובי":master>=55?"חיובי מתון":master>=45?"ניטרלי":master>=30?"זהירות":"שלילי"}}
function target(score){return score>=70?.80:score>=55?.65:score>=45?.50:score>=30?.35:.25}
function slot5(d=new Date()){const z=new Date(d);z.setUTCSeconds(0,0);z.setUTCMinutes(Math.floor(z.getUTCMinutes()/5)*5);return z.toISOString().slice(0,16).replace(/[:T]/g,"-")}
async function heartbeat(patch){const prev=await db("agent_monitor_status?select=checks&id=eq.1&limit=1"),checks=Number(prev?.[0]?.checks||0)+1;await db("agent_monitor_status?id=eq.1",{method:"PATCH",body:JSON.stringify({...patch,checks,checked_at:new Date().toISOString(),updated_at:new Date().toISOString()})})}
export default async()=>{try{
  const rows=await db("paper_portfolio?select=*&status=eq.open&order=updated_at.asc");
  const ps=(rows||[]).filter(p=>["SPY","QQQ"].includes(String(p.symbol).toUpperCase())).slice(0,2);
  if(!ps.length){await heartbeat({status:"idle",symbols:[],note:"אין תוכניות SPY/QQQ פתוחות"});return}

  const fxData=await td("price",{symbol:"USD/ILS"}),fx=Number(fxData?.price);if(!Number.isFinite(fx))throw Error("No USD/ILS rate");
  const scores={},marketDates=[];
  for(const p of ps){
    // 2 credits per symbol: daily history for the model + current price for an intraday refresh.
    const [hist,quote]=await Promise.all([
      td("time_series",{symbol:p.symbol,interval:"1day",outputsize:100,order:"DESC"}),
      td("price",{symbol:p.symbol})
    ]);
    const values=Array.isArray(hist?.values)?hist.values:[];if(values.length<20)throw Error("No daily market series for "+p.symbol);
    const current=Number(quote?.price),pr=values.map(v=>({date:String(v.datetime).slice(0,10),close:Number(v.close)})).filter(x=>Number.isFinite(x.close));
    if(Number.isFinite(current)&&pr.length)pr[0]={...pr[0],close:current};
    const latest=pr[0],a=calc(pr);marketDates.push(latest.date);
    const actual=(+p.start)>0?(+p.allocated_ils)/(+p.start):null,mode=p.strategy_mode||p.plan,te=mode==="ai_dynamic"?target(a.master):({conservative:.25,balanced:.5,growth:.8}[mode]||.5);
    const action=mode==="ai_dynamic"?(te>(actual+.02)?"הגדלת חשיפה":te<(actual-.02)?"הקטנת חשיפה":"ללא שינוי"):"מסלול קבוע";
    scores[p.symbol]={master:a.master,market:a.marketS,trend:a.trend,risk:a.risk,momentum:a.mom,recommendation:a.signal,target_exposure:te,actual_exposure:actual,ai_action:action,market_price:a.last,market_date:latest.date};

    // A separate simulated observation every 5-minute slot. No real trade is executed and units are never changed.
    const key=`monitor-${p.id}-${p.symbol}-${slot5()}`,ex=await db(`portfolio_snapshots?select=id&snapshot_key=eq.${encodeURIComponent(key)}&limit=1`);
    if(!ex?.length){const pv=(+p.units)*a.last*fx,ppnl=pv-(+p.allocated_ils);await db("portfolio_snapshots",{method:"POST",body:JSON.stringify({snapshot_key:key,date:latest.date,symbol:p.symbol,position_id:String(p.id),position_value:pv,position_pnl:ppnl,value:null,pnl:null,fx,score:a.master,market_price:a.last,auto:true,market_score:a.marketS,trend_score:a.trend,risk_score:a.risk,momentum_score:a.mom,recommendation:a.signal,plan:mode||null,target_exposure:te,actual_exposure:actual,ai_action:action})})}
  }
  await heartbeat({status:"ok",symbols:ps.map(p=>p.symbol),last_market_date:marketDates.sort().reverse()[0]||null,scores,note:"Twelve Data · בדיקה אוטומטית כל 5 דקות בחלון המסחר · סימולציה בלבד"});
}catch(e){console.error("AI_MONITOR_ERROR",e?.stack||String(e));try{await heartbeat({status:"error",note:String(e?.message||e)})}catch{};throw e}};
// 5-minute checks, Monday-Friday, 14:00-21:59 UTC. This covers the US regular session across DST changes with margin.
// Each run is about 5 Twelve Data credits for SPY + QQQ + USD/ILS => about 480/day, below the Basic 800/day limit.
export const config={schedule:"*/5 14-21 * * 1-5"};
