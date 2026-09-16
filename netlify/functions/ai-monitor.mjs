import {db,td,bars,WATCHLIST,slot,marketOpen} from '../../lib/agent.mjs';
export default async function monitor(){
  const errors=[];let symbols=[],checks=0,result=null,open=marketOpen();
  try{
    const [rows,status]=await Promise.all([db('paper_portfolio?select=symbol&status=eq.open'),db('agent_monitor_status?select=checks&id=eq.1&limit=1')]);
    symbols=rows.map(p=>p.symbol);checks=Number(status?.[0]?.checks||0)+1;
    if(symbols.length&&open){
      const done=await db('paper_cycle_runs?slot=eq.'+encodeURIComponent(slot())+'&select=slot&limit=1');
      if(done.length)return new Response(null,{status:204});
      const universe=[...new Set([...WATCHLIST,...symbols])];
      const loaded=await Promise.allSettled([td('price',{symbol:'USD/ILS'}),...universe.map(symbol=>bars(symbol))]);
      const failed=loaded.find(x=>x.status==='rejected');if(failed)throw failed.reason;
      const fxData=loaded[0].value,quotes=universe.map((symbol,i)=>[symbol,loaded[i+1].value]);
      result=await db('rpc/apply_paper_cycle',{method:'POST',body:JSON.stringify({p_slot:slot(),p_fx:Number(fxData.price),p_quotes:Object.fromEntries(quotes)})});
      symbols=result.symbols||symbols;
    }
  }catch(e){errors.push(e.message);}
  const waiting=errors.some(e=>/ממתין למכסת|API credits/i.test(e));
  const note='V6.3 · בדיקה כל 3 דקות; מחזור החלטה כל 30 דקות · '+(errors.length?errors.join(' | '):!symbols.length?'אין תוכניות פתוחות':!open?'מחוץ לשעות המסחר — ממתין':result?.rotation?`מעבר אוטומטי מ־${result.rotation.from_symbol} ל־${result.rotation.to_symbol}; ההיסטוריה והרווח המצטבר נשמרו`:'מעקב כל 30 דקות לפי מסלול והגדרות האוטומציה · מעבר נכס אחרי 3 סריקות מאמתות ופער של 10 נקודות · סימולציה בלבד');
  await db('agent_monitor_status?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({id:1,checks,status:waiting?'waiting':errors.length?'error':symbols.length&&open?'ok':'idle',symbols,scores:result?.scores||{},checked_at:new Date().toISOString(),updated_at:new Date().toISOString(),note})});
  if(errors.length&&!waiting)throw Error(note);
  return new Response(null,{status:204});
}
export const config={schedule:'*/3 13-21 * * 1-5'};
