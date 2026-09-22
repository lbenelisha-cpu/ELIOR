// Buy-and-hold: fixed units, no rebalancing, same ILS valuation dates.
export function benchmark(base,last){
 const valid=x=>x&&Number(x.value)>0&&Number(x.fx)>0&&['SPY','QQQ'].every(s=>Number(x.marks?.[s]?.price)>0);
 if(!valid(base)||!valid(last))return {available:false,reason:'ממתין לנקודת בסיס ולמחירי SPY ו־QQQ תקינים'};
 if(Number(base.capital)!==Number(last.capital))return {available:false,reason:'ההון השתנה; נדרשת התאמה לתזרימי כסף לפני השוואה'};
 const initial=Number(base.value),value=initial*.5*Number(last.fx)/Number(base.fx)*(Number(last.marks.SPY.price)/Number(base.marks.SPY.price)+Number(last.marks.QQQ.price)/Number(base.marks.QQQ.price));
 const portfolioReturn=(Number(last.value)/initial-1)*100,benchmarkReturn=(value/initial-1)*100;
 return {available:true,start:base.created_at,end:last.created_at||last.updated_at,initial,portfolioValue:Number(last.value),benchmarkValue:value,portfolioReturn,benchmarkReturn,excessPoints:portfolioReturn-benchmarkReturn};
}
