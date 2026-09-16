import {db,td,bars,WATCHLIST,slot,marketOpen} from '../../lib/agent.mjs';
export default async function monitor(){
  const errors=[];let symbols=[],checks=0,result=null,open=marketOpen();
  try{
    const [rows,status]=await Promise.all([db('paper_portfolio?select=symbol&status=eq.open'),db('agent_monitor_status?select=checks&id=eq.1&limit=1')]);
    symbols=rows.map(p=>p.symbol);checks=Number(status?.[0]?.checks||0)+1;
    if(symbols.length&&open){
      const universe=[...new Set([...WATCHLIST,...symbols])];
      const [fxData,quotes]=await Promise.all([td('price',{symbol:'USD/ILS'}),Promise.all(universe.map(async symbol=>[symbol,await bars(symbol)]))]);
      result=await db('rpc/apply_paper_cycle',{method:'POST',body:JSON.stringify({p_slot:slot(),p_fx:Number(fxData.price),p_quotes:Object.fromEntries(quotes)})});
      symbols=result.symbols||symbols;
    }
  }catch(e){errors.push(e.message);}
  const note=errors.length?errors.join(' | '):!symbols.length?'אין תוכניות פתוחות':!open?'מחוץ לשעות המסחר — ממתין':result?.rotation?`מעבר אוטומטי מ־${result.rotation.from_symbol} ל־${result.rotation.to_symbol}; ההיסטוריה והרווח המצטבר נשמרו`:'מעקב כל 30 דקות · מעבר נכס אחרי 3 סריקות מאמתות ופער של 10 נקודות · סימולציה בלבד';
  await db('agent_monitor_status?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({id:1,checks,status:errors.length?'error':symbols.length&&open?'ok':'idle',symbols,scores:result?.scores||{},checked_at:new Date().toISOString(),updated_at:new Date().toISOString(),note})});
  if(errors.length)throw Error(note);
  return new Response(null,{status:204});
}
export const config={schedule:'3,33 13-20 * * 1-5'};
