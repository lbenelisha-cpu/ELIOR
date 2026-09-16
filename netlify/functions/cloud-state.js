import {db,td,bars} from '../../lib/agent.mjs';
const headers={'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Cache-Control':'no-store'};
const mapPosition=x=>({id:x.id,symbol:x.symbol,start:+x.start,allocatedILS:+x.allocated_ils,allocatedUSD:+x.allocated_usd,entryFX:+x.entry_fx,entryPrice:+x.entry_price,units:+x.units,cashILS:+x.cash_ils,date:x.entry_date,plan:x.strategy_mode||x.plan,status:x.status,autoRebalance:x.auto_rebalance??((x.strategy_mode||x.plan)==='ai_dynamic'),autoRotate:x.auto_rotate??((x.strategy_mode||x.plan)==='ai_dynamic'),settingsVersion:Number(x.settings_version||1),predecessorId:x.predecessor_id,realizedPnl:+x.realized_pnl_ils,closedAt:x.closed_at,closedValue:+x.closed_value_ils,closedPrice:+x.closed_market_price,closedUnits:+x.closed_units});
async function state(){
 const [s,monitor]=await Promise.all([db('rpc/paper_get_state',{method:'POST',body:'{}'}),db('agent_monitor_status?select=*&id=eq.1&limit=1').catch(()=>[])]);
 const portfolios=(s.rows||[]).map(mapPosition);
 return {...s,apiVersion:"6.2",rows:undefined,portfolio:portfolios[0]||null,portfolios,closed:(s.closed||[]).map(mapPosition),monitor:portfolios.length?monitor[0]||null:null};
}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return {statusCode:204,headers,body:''};
 try{
  const action=event.queryStringParameters?.action||'get';
  const body=event.body?JSON.parse(event.body):{};
  if(action==='health'){
   await db('rpc/paper_get_state',{method:'POST',body:'{}'});
   return {statusCode:200,headers,body:JSON.stringify({ok:true,rotationSchema:true,apiVersion:'6.2'})};
  }
  if(action==='get')return {statusCode:200,headers,body:JSON.stringify(await state())};
  if(event.httpMethod!=='POST')return {statusCode:405,headers,body:JSON.stringify({error:'POST required'})};
  if(!['save_portfolio','close_portfolio','update_plan','reset','account_snapshot'].includes(action))throw Error('Unknown action');
  let quotes={},fx=null;
  if(['save_portfolio','close_portfolio','account_snapshot'].includes(action)){
   const rows=await db('paper_portfolio?select=symbol&status=eq.open');
   const symbols=[...new Set([...rows.map(p=>p.symbol),...(action==='save_portfolio'?[String(body.symbol||'').toUpperCase()]:[])])];
   if(symbols.some(s=>!/^[A-Z.\-]{1,12}$/.test(s)))throw Error('Invalid symbol');
   const [rate,values]=await Promise.all([td('price',{symbol:'USD/ILS'}),Promise.all(symbols.map(async symbol=>[symbol,await bars(symbol)]))]);
   fx=Number(rate.price);quotes=Object.fromEntries(values);
  }
  await db('rpc/manage_paper_portfolio',{method:'POST',body:JSON.stringify({p_action:action,p_body:body,p_quotes:quotes,p_fx:fx})});
  return {statusCode:200,headers,body:JSON.stringify({...await state(),ok:true})};
 }catch(e){return {statusCode:400,headers,body:JSON.stringify({error:e.message})};}
}
