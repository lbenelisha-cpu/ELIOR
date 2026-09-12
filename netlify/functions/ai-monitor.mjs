const RAW=process.env.SUPABASE_URL||"";
const SB=RAW.trim().replace(/\/+$/,"").replace(/\/rest\/v1$/i,"");
const SK=process.env.SUPABASE_SERVICE_ROLE_KEY, AK=process.env.ALPHA_VANTAGE_API_KEY;
const H=()=>({apikey:SK,Authorization:`Bearer ${SK}`,"Content-Type":"application/json",Prefer:"return=representation"});
async function db(p,o={}){const r=await fetch(`${SB}/rest/v1/${p}`,{...o,headers:{...H(),...(o.headers||{})}}),t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d={raw:t}}if(!r.ok)throw Error(d?.message||`Supabase ${r.status}`);return d}
async function av(q){const u=new URL("https://www.alphavantage.co/query");Object.entries({...q,apikey:AK}).forEach(([k,v])=>u.searchParams.set(k,v));const r=await fetch(u),d=await r.json();if(d.Note||d.Information||d["Error Message"])throw Error(d.Note||d.Information||d["Error Message"]);return d}
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length,clamp=x=>Math.max(0,Math.min(100,Math.round(x)));
function calc(pr){const c=pr.map(x=>x.close),last=c[0],r5=(last/c[Math.min(5,c.length-1)]-1)*100,r20=(last/c[Math.min(20,c.length-1)]-1)*100,r60=(last/c[Math.min(60,c.length-1)]-1)*100,s20=mean(c.slice(0,20)),s60=mean(c.slice(0,60)),rs=[];for(let i=0;i<c.length-1;i++)rs.push(c[i]/c[i+1]-1);const m=mean(rs),vol=Math.sqrt(mean(rs.map(x=>(x-m)**2)))*Math.sqrt(252)*100,marketS=clamp(50+r60*2),trend=clamp(50+(last/s20-1)*500+(s20/s60-1)*400),risk=clamp(90-vol*2.2),mom=clamp(50+r5*3+r20*1.5),master=clamp((marketS+trend+risk+mom)/4);return{last,marketS,trend,risk,mom,master,signal:master>=70?"חיובי":master>=55?"חיובי מתון":master>=45?"ניטרלי":master>=30?"זהירות":"שלילי"}}
function target(score){return score>=70?.80:score>=55?.65:score>=45?.50:score>=30?.35:.25}
async function heartbeat(patch){const prev=await db("agent_monitor_status?select=checks&id=eq.1&limit=1"),checks=Number(prev?.[0]?.checks||0)+1;await db("agent_monitor_status?id=eq.1",{method:"PATCH",body:JSON.stringify({...patch,checks,checked_at:new Date().toISOString(),updated_at:new Date().toISOString()})})}
export default async()=>{try{
  const rows=await db("paper_portfolio?select=*&status=eq.open&order=updated_at.asc");
  // Current experiment intentionally monitors only SPY and QQQ to stay inside the free Alpha Vantage daily request budget.
  const ps=(rows||[]).filter(p=>["SPY","QQQ"].includes(String(p.symbol).toUpperCase())).slice(0,2);
  if(!ps.length){await heartbeat({status:"idle",symbols:[],note:"אין תוכניות SPY/QQQ פתוחות"});return}
  const fd=await av({function:"CURRENCY_EXCHANGE_RATE",from_currency:"USD",to_currency:"ILS"}),fx=+fd["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"];
  if(!fx)throw Error("No USD/ILS rate");
  const scores={},marketDates=[];
  for(const p of ps){
    await new Promise(r=>setTimeout(r,1300));
    const md=await av({function:"TIME_SERIES_DAILY",symbol:p.symbol,outputsize:"compact"}),series=md["Time Series (Daily)"];
    if(!series)throw Error("No daily market series for "+p.symbol);
    const dates=Object.keys(series).sort().reverse(),pr=dates.slice(0,100).map(date=>({date,close:+series[date]["4. close"]})),latest=pr[0],a=calc(pr);marketDates.push(latest.date);
    const actual=(+p.start)>0?(+p.allocated_ils)/(+p.start):null,te=(p.strategy_mode||p.plan)==="ai_dynamic"?target(a.master):({conservative:.25,balanced:.5,growth:.8}[p.strategy_mode||p.plan]||.5);
    const action=(p.strategy_mode||p.plan)==="ai_dynamic"?(te>(actual+.02)?"הגדלת חשיפה":te<(actual-.02)?"הקטנת חשיפה":"ללא שינוי"):"מסלול קבוע";
    scores[p.symbol]={master:a.master,market:a.marketS,trend:a.trend,risk:a.risk,momentum:a.mom,recommendation:a.signal,target_exposure:te,actual_exposure:actual,ai_action:action,market_price:a.last,market_date:latest.date};
    // One decision row per market date/program. Repeated hourly checks update heartbeat but do not duplicate the daily journal.
    const key=`monitor-${p.id}-${p.symbol}-${latest.date}`,ex=await db(`portfolio_snapshots?select=id&snapshot_key=eq.${encodeURIComponent(key)}&limit=1`);
    if(!ex?.length){const pv=(+p.units)*a.last*fx,ppnl=pv-(+p.allocated_ils);await db("portfolio_snapshots",{method:"POST",body:JSON.stringify({snapshot_key:key,date:latest.date,symbol:p.symbol,position_id:String(p.id),position_value:pv,position_pnl:ppnl,value:null,pnl:null,fx,score:a.master,market_price:a.last,auto:true,market_score:a.marketS,trend_score:a.trend,risk_score:a.risk,momentum_score:a.mom,recommendation:a.signal,plan:(p.strategy_mode||p.plan)||null,target_exposure:te,actual_exposure:actual,ai_action:action})})}
  }
  await heartbeat({status:"ok",symbols:ps.map(p=>p.symbol),last_market_date:marketDates.sort().reverse()[0]||null,scores,note:"בדיקה אוטומטית הסתיימה. מקור SPY/QQQ הוא Daily Close, לא מחיר תוך-יומי."});
}catch(e){console.error("AI_MONITOR_ERROR",e?.stack||String(e));try{await heartbeat({status:"error",note:String(e?.message||e)})}catch{};throw e}};
// 8 hourly checks on US trading weekdays. With 2 symbols + FX = 24 Alpha Vantage requests/day.
export const config={schedule:"0 14-21 * * 1-5"};
