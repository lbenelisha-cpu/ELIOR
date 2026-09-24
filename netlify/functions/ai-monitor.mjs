import {db,td,barSeries,alignSeries,WATCHLIST,slot,marketOpen} from '../../lib/agent.mjs';
export default async function monitor(){
 const errors=[];let symbols=[],checks=0,result=null,previous={},open=marketOpen(),completed=false;
 const diagnostics={waiting_assets:[]};
 try{
  const [rows,status]=await Promise.all([db('paper_portfolio?select=symbol&status=eq.open'),db('agent_monitor_status?select=*&id=eq.1&limit=1')]);
  previous=status?.[0]||{};symbols=rows.map(p=>p.symbol);checks=Number(previous.checks||0)+1;
  diagnostics.last_success_at=previous.diagnostics?.last_success_at||null;
  if(symbols.length&&open){
   const cycleSlot=slot();
   const done=await db('paper_cycle_runs?slot=eq.'+encodeURIComponent(cycleSlot)+'&select=slot,result&limit=1');
   if(done.length){
    result=done[0].result||{scores:previous.scores};completed=true;
    diagnostics.reason='המחזור הנוכחי כבר הושלם; ממתין לחלון ההחלטה הבא';
   }else{
    const universe=[...new Set([...WATCHLIST,...symbols])];
    const loaded=await Promise.allSettled([td('price',{symbol:'USD/ILS'}),...universe.map(symbol=>barSeries(symbol))]);
    diagnostics.waiting_assets=loaded.flatMap((x,i)=>x.status==='rejected'?[{symbol:i===0?'USD/ILS':universe[i-1],reason:x.reason?.message||String(x.reason)}]:[]);
    if(diagnostics.waiting_assets.length)throw Error(diagnostics.waiting_assets.map(x=>x.symbol+': '+x.reason).join(' | '));
    const fxData=loaded[0].value;
    let quotes;
    try{quotes=alignSeries(Object.fromEntries(universe.map((symbol,i)=>[symbol,loaded[i+1].value])));}
    catch(e){diagnostics.bar_times=Object.fromEntries(universe.map((symbol,i)=>[symbol,loaded[i+1].value.values?.[0]?.datetime||null]));throw e;}
    result=await db('rpc/apply_paper_cycle',{method:'POST',body:JSON.stringify({p_slot:cycleSlot,p_fx:Number(fxData.price),p_quotes:quotes})});
    completed=true;diagnostics.last_success_at=new Date().toISOString();
    diagnostics.reason='מחזור החלטה הושלם';
   }
   symbols=result.symbols||symbols;
   diagnostics.rotation_reason=result.rotation_reason||null;
   diagnostics.decisions=Object.fromEntries(Object.entries(result.scores||{}).map(([symbol,s])=>[symbol,s.ai_action||'אין פירוט החלטה']));
   diagnostics.next_cycle_at=new Date(Date.parse(cycleSlot)+1800000).toISOString();
  }else diagnostics.reason=symbols.length?'מחוץ לשעות המסחר — ממתין לפתיחת חלון הפעילות':'אין תוכנית פתוחה — נדרשת פתיחת תוכנית כדי להתחיל החלטות אוטומטיות';
 }catch(e){errors.push(e.message);diagnostics.reason=e.message;}
 const waiting=errors.length>0&&errors.every(e=>/ממתין לנתונים מסונכרנים|ממתין למכסת|API credits/i.test(e));
 if(errors.length&&open)diagnostics.retry_note='ניסיון נוסף בהרצה המתוזמנת הבאה, בדרך כלל בתוך 3 דקות';
 const note='V6.4 · '+diagnostics.reason+' · סימולציה בלבד';
 await db('agent_monitor_status?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({id:1,checks,status:waiting?'waiting':errors.length?'error':completed?'ok':'idle',symbols,scores:result?.scores||previous.scores||{},checked_at:new Date().toISOString(),updated_at:new Date().toISOString(),note,diagnostics})});
 if(errors.length&&!waiting)throw Error(note);
 return new Response(null,{status:204});
}
export const config={schedule:'*/3 13-21 * * 1-5'};
