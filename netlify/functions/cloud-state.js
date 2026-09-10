const SUPABASE_URL=process.env.SUPABASE_URL;
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers={
  "Content-Type":"application/json; charset=utf-8",
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"Content-Type",
  "Access-Control-Allow-Methods":"GET,POST,OPTIONS"
};

function sbHeaders(){
  return {
    "apikey":SERVICE_KEY,
    "Authorization":`Bearer ${SERVICE_KEY}`,
    "Content-Type":"application/json",
    "Prefer":"return=representation"
  };
}

async function sb(path,opts={}){
  if(!SUPABASE_URL||!SERVICE_KEY) throw Error("Supabase environment variables are missing");
  const url=`${SUPABASE_URL.replace(/\/+$/,"")}/rest/v1/${path}`;
  const r=await fetch(url,{...opts,headers:{...sbHeaders(),...(opts.headers||{})}});
  const text=await r.text();
  let data=null;
  try{ data=text?JSON.parse(text):null }catch{ data={raw:text} }
  if(!r.ok){
    console.error("SUPABASE_ERROR",{
      status:r.status,
      path,
      message:data?.message,
      code:data?.code,
      details:data?.details,
      hint:data?.hint
    });
    throw Error(data?.message||data?.hint||`Supabase HTTP ${r.status}`);
  }
  return data;
}

exports.handler=async event=>{
  if(event.httpMethod==="OPTIONS") return {statusCode:204,headers,body:""};
  try{
    const action=event.queryStringParameters?.action||"get";
    const body=event.body?JSON.parse(event.body):{};

    if(action==="health"){
      const result={
        env:{
          supabaseUrl:!!SUPABASE_URL,
          serviceRoleKey:!!SERVICE_KEY
        },
        urlHost:null,
        paperTable:false,
        snapshotsTable:false
      };
      try{ result.urlHost=new URL(SUPABASE_URL).host }catch{}
      try{ await sb("paper_portfolio?select=id&limit=1"); result.paperTable=true }catch(e){ result.paperError=e.message }
      try{ await sb("portfolio_snapshots?select=id&limit=1"); result.snapshotsTable=true }catch(e){ result.snapshotsError=e.message }
      return {statusCode:200,headers,body:JSON.stringify(result)};
    }

    if(action==="get"){
      const p=await sb("paper_portfolio?select=*&status=eq.open&order=updated_at.desc&limit=1");
      const s=await sb("portfolio_snapshots?select=*&order=date.asc&limit=365");
      return {statusCode:200,headers,body:JSON.stringify({portfolio:p?.[0]||null,snapshots:s||[]})};
    }

    if(action==="save_portfolio"){
      await sb("paper_portfolio?status=eq.open",{
        method:"PATCH",
        body:JSON.stringify({status:"closed",closed_at:new Date().toISOString(),updated_at:new Date().toISOString()})
      });
      const row={
        symbol:body.symbol,
        start:body.start,
        allocated_ils:body.allocatedILS,
        allocated_usd:body.allocatedUSD,
        entry_fx:body.entryFX,
        entry_price:body.entryPrice,
        units:body.units,
        cash_ils:body.cashILS,
        entry_date:body.date,
        plan:body.plan,
        status:"open",
        updated_at:new Date().toISOString()
      };
      const p=await sb("paper_portfolio",{method:"POST",body:JSON.stringify(row)});
      const x=p[0];
      const portfolio={
        id:x.id,symbol:x.symbol,start:+x.start,
        allocatedILS:+x.allocated_ils,allocatedUSD:+x.allocated_usd,
        entryFX:+x.entry_fx,entryPrice:+x.entry_price,units:+x.units,
        cashILS:+x.cash_ils,date:x.entry_date,plan:x.plan,status:x.status
      };
      return {statusCode:200,headers,body:JSON.stringify({portfolio})};
    }

    if(action==="save_snapshot"){
      const row={
        snapshot_key:body.snapshot_key,date:body.date,symbol:body.symbol,
        value:body.value,pnl:body.pnl,fx:body.fx,score:body.score,
        market_price:body.market_price,auto:!!body.auto
      };
      await sb("portfolio_snapshots?on_conflict=snapshot_key",{
        method:"POST",
        headers:{"Prefer":"resolution=ignore-duplicates,return=representation"},
        body:JSON.stringify(row)
      });
      const s=await sb("portfolio_snapshots?select=*&order=date.asc&limit=365");
      return {statusCode:200,headers,body:JSON.stringify({snapshots:s||[]})};
    }

    if(action==="close_portfolio"){
      await sb("paper_portfolio?status=eq.open",{
        method:"PATCH",
        body:JSON.stringify({status:"closed",closed_at:body.closed_at||new Date().toISOString(),updated_at:new Date().toISOString()})
      });
      return {statusCode:200,headers,body:JSON.stringify({ok:true})};
    }

    if(action==="reset"){
      await sb("portfolio_snapshots?id=not.is.null",{method:"DELETE"});
      await sb("paper_portfolio?id=not.is.null",{method:"DELETE"});
      return {statusCode:200,headers,body:JSON.stringify({ok:true})};
    }

    return {statusCode:400,headers,body:JSON.stringify({error:"Unknown action"})};
  }catch(e){
    console.error("CLOUD_STATE_ERROR",e && e.stack ? e.stack : String(e));
    return {statusCode:500,headers,body:JSON.stringify({error:e.message||"Cloud error"})};
  }
};