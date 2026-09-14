const RAW=process.env.SUPABASE_URL||"";
const SB=RAW.trim().replace(/\/+$/,"" ).replace(/\/rest\/v1$/i,"");
const SK=process.env.SUPABASE_SERVICE_ROLE_KEY;
const TK=process.env.TWELVE_DATA_API_KEY;

const H=()=>({
  apikey:SK,
  Authorization:`Bearer ${SK}`,
  "Content-Type":"application/json",
  Prefer:"return=representation"
});

async function db(p,o={}){
  const r=await fetch(`${SB}/rest/v1/${p}`,{
    ...o,
    headers:{...H(),...(o.headers||{})}
  });
  const t=await r.text();
  let d;
  try{d=t?JSON.parse(t):null}catch{d={raw:t}}
  if(!r.ok)throw Error(d?.message||`Supabase ${r.status}`);
  return d;
}

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

function calc(pr){
  const c=pr.map(x=>x.close),last=c[0];
  const r5=(last/c[Math.min(5,c.length-1)]-1)*100;
  const r20=(last/c[Math.min(20,c.length-1)]-1)*100;
  const r60=(last/c[Math.min(60,c.length-1)]-1)*100;
  const s20=mean(c.slice(0,20)),s60=mean(c.slice(0,60)),rs=[];
  for(let i=0;i<c.length-1;i++)rs.push(c[i]/c[i+1]-1);
  const m=mean(rs);
  const vol=Math.sqrt(mean(rs.map(x=>(x-m)**2)))*Math.sqrt(252)*100;
  const marketS=clamp(50+r60*2);
  const trend=clamp(50+(last/s20-1)*500+(s20/s60-1)*400);
  const risk=clamp(90-vol*2.2);
  const mom=clamp(50+r5*3+r20*1.5);
  const master=clamp((marketS+trend+risk+mom)/4);
  return{last,marketS,trend,risk,mom,master,signal:master>=70?"חיובי":master>=55?"חיובי מתון":master>=45?"ניטרלי":master>=30?"זהירות":"שלילי"};
}

function target(score){return score>=70?.80:score>=55?.65:score>=45?.50:score>=30?.35:.25}
function slot6(d=new Date()){const z=new Date(d);z.setUTCSeconds(0,0);z.setUTCMinutes(Math.floor(z.getUTCMinutes()/6)*6);return z.toISOString().slice(0,16).replace(/[:T]/g,"-")}
function baseAction(v=""){v=String(v);if(v.startsWith("הגדלת חשיפה"))return"הגדלת חשיפה";if(v.startsWith("הקטנת חשיפה"))return"הקטנת חשיפה";if(v.startsWith("ללא שינוי"))return"ללא שינוי";return v}
function ils(n){return `₪${Math.round(Number(n)||0).toLocaleString("he-IL")}`}

async function heartbeat(patch){
  const prev=await db("agent_monitor_status?select=checks&id=eq.1&limit=1");
  const checks=Number(prev?.[0]?.checks||0)+1;
  await db("agent_monitor_status?id=eq.1",{method:"PATCH",body:JSON.stringify({...patch,checks,checked_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
}

async function confirmedDecision(positionId,action){
  if(!["הגדלת חשיפה","הקטנת חשיפה"].includes(action))return false;
  const rows=await db(`portfolio_snapshots?select=ai_action,snapshot_key,created_at&position_id=eq.${encodeURIComponent(positionId)}&order=created_at.desc&limit=8`);
  const prior=(rows||[]).filter(x=>String(x.snapshot_key||"").startsWith("monitor-")).slice(0,2);
  return prior.length===2&&prior.every(x=>baseAction(x.ai_action)===action);
}

export default async()=>{try{
  const rows=await db("paper_portfolio?select=*&status=eq.open&order=updated_at.asc");
  const ps=(rows||[]).filter(p=>["SPY","QQQ"].includes(String(p.symbol).toUpperCase())).slice(0,2);
  if(!ps.length){await heartbeat({status:"idle",symbols:[],note:"אין תוכניות SPY/QQQ פתוחות"});return}

  const fxData=await td("price",{symbol:"USD/ILS"}),fx=Number(fxData?.price);
  if(!Number.isFinite(fx))throw Error("No USD/ILS rate");

  const scores={},marketDates=[];

  for(const p of ps){
    const [hist,quote]=await Promise.all([
      td("time_series",{symbol:p.symbol,interval:"1day",outputsize:100,order:"DESC"}),
      td("price",{symbol:p.symbol})
    ]);
    const values=Array.isArray(hist?.values)?hist.values:[];
    if(values.length<20)throw Error("No daily market series for "+p.symbol);
    const current=Number(quote?.price);
    const pr=values.map(v=>({date:String(v.datetime).slice(0,10),close:Number(v.close)})).filter(x=>Number.isFinite(x.close));
    if(Number.isFinite(current)&&pr.length)pr[0]={...pr[0],close:current};

    const latest=pr[0],a=calc(pr);marketDates.push(latest.date);
    const mode=p.strategy_mode||p.plan;
    const pvBefore=(+p.units)*a.last*fx;
    const actual=(+p.start)>0?pvBefore/(+p.start):null;
    const te=mode==="ai_dynamic"?target(a.master):({conservative:.25,balanced:.5,growth:.8}[mode]||.5);
    const action=mode==="ai_dynamic"?(te>(actual+.02)?"הגדלת חשיפה":te<(actual-.02)?"הקטנת חשיפה":"ללא שינוי"):"מסלול קבוע";

    let finalAction=action;
    let snapshotPV=pvBefore;
    let snapshotAllocated=+p.allocated_ils;
    let snapshotActual=actual;

    if(mode==="ai_dynamic"&&["הגדלת חשיפה","הקטנת חשיפה"].includes(action)){
      const confirmed=await confirmedDecision(String(p.id),action);
      if(confirmed){
        const start=+p.start||100000;
        const desiredPV=start*te;
        const usedAllocated=(rows||[]).filter(x=>x.status==="open").reduce((s,x)=>s+(+x.allocated_ils||0),0);
        const freeCash=Math.max(0,start-usedAllocated);
        let targetPV=desiredPV;

        if(action==="הגדלת חשיפה")targetPV=Math.min(desiredPV,pvBefore+freeCash);

        const tradeValue=targetPV-pvBefore;
        if(Math.abs(tradeValue)>=100){
          const newUnits=targetPV/(a.last*fx);
          // Preserve accumulated portfolio P/L while moving cash in/out of the simulated position.
          const newAllocated=(+p.allocated_ils||0)+tradeValue;
          const newAllocatedUSD=newAllocated/fx;

          await db(`paper_portfolio?id=eq.${encodeURIComponent(p.id)}`,{
            method:"PATCH",
            body:JSON.stringify({
              allocated_ils:newAllocated,
              allocated_usd:newAllocatedUSD,
              units:newUnits,
              updated_at:new Date().toISOString()
            })
          });

          p.allocated_ils=newAllocated;
          p.allocated_usd=newAllocatedUSD;
          p.units=newUnits;
          snapshotPV=targetPV;
          snapshotAllocated=newAllocated;
          snapshotActual=start>0?targetPV/start:null;
          finalAction=tradeValue>0
            ?`הגדלת חשיפה · קנייה וירטואלית ${ils(tradeValue)}`
            :`הקטנת חשיפה · מכירה וירטואלית ${ils(Math.abs(tradeValue))}`;
        }else if(action==="הגדלת חשיפה"&&freeCash<100){
          finalAction="הגדלת חשיפה · אין מזומן מדומה פנוי";
        }
      }else{
        finalAction=`${action} · ממתין לאישור 3 דגימות`;
      }
    }

    scores[p.symbol]={master:a.master,market:a.marketS,trend:a.trend,risk:a.risk,momentum:a.mom,recommendation:a.signal,target_exposure:te,actual_exposure:snapshotActual,ai_action:finalAction,market_price:a.last,market_date:latest.date};

    const key=`monitor-${p.id}-${p.symbol}-${slot6()}`;
    const ex=await db(`portfolio_snapshots?select=id&snapshot_key=eq.${encodeURIComponent(key)}&limit=1`);
    if(!ex?.length){
      const ppnl=snapshotPV-snapshotAllocated;
      await db("portfolio_snapshots",{method:"POST",body:JSON.stringify({
        snapshot_key:key,date:latest.date,symbol:p.symbol,position_id:String(p.id),
        position_value:snapshotPV,position_pnl:ppnl,value:snapshotPV,pnl:ppnl,fx,
        score:a.master,market_price:a.last,auto:true,market_score:a.marketS,
        trend_score:a.trend,risk_score:a.risk,momentum_score:a.mom,
        recommendation:a.signal,plan:mode||null,target_exposure:te,
        actual_exposure:snapshotActual,ai_action:finalAction
      })});
    }
  }

  await heartbeat({status:"ok",symbols:ps.map(p=>p.symbol),last_market_date:marketDates.sort().reverse()[0]||null,scores,note:"Twelve Data · כל 6 דקות · 80 דגימות ביום · AI Dynamic מבצע קנייה/מכירה וירטואלית רק אחרי 3 אישורים רצופים · סימולציה בלבד"});
}catch(e){
  console.error("AI_MONITOR_ERROR",e?.stack||String(e));
  try{await heartbeat({status:"error",note:String(e?.message||e)})}catch{}
  throw e;
}};

// 6-minute checks, Monday-Friday, 14:00-21:59 UTC.
// AI Dynamic can rebalance the paper portfolio only after 3 consecutive matching decisions.
// No brokerage connection and no real-money order is sent.
export const config={schedule:"*/6 14-21 * * 1-5"};
