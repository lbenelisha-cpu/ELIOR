import {normalizeBars,RULES} from './meitav-paper.mjs';
import {evaluateWaveStrategy} from './meitav-wave-strategy.mjs';
export function backtestLegacyWave(rows,feePct=0.1){
 if(!Number.isFinite(feePct)||feePct<0||feePct>5)throw Error('עמלה לא תקינה');
 const bars=normalizeBars(rows),fee=feePct/100;let cash=10000,qty=0,peak=0,top=10000,maxDrawdown=0,trades=0,pending=null;
 const curve=[];
 // A closing-bar signal is executed at the NEXT available close, never retrospectively.
 for(let i=202;i<bars.length;i++){
  const price=bars[i].close;
  if(pending==='BUY'&&qty===0){qty=cash/(price*(1+fee));cash=0;peak=price;trades++;}
  if(pending==='SELL'&&qty>0){cash=qty*price*(1-fee);qty=0;trades++;}
  pending=null;const s=evaluateWaveStrategy(bars.slice(0,i+1),RULES);
  if(qty>0){peak=Math.max(peak,price);if(price<=peak*.99||s.sellConfirmed)pending='SELL';}
  else if(s.buyConfirmed)pending='BUY';
  const value=cash+qty*price;top=Math.max(top,value);maxDrawdown=Math.max(maxDrawdown,(top-value)/top*100);curve.push({date:bars[i].date,value});
 }
 const value=cash+qty*bars.at(-1).close,hold=10000/(bars[202].close*(1+fee))*bars.at(-1).close;
 return {value,returnPct:(value/10000-1)*100,holdReturnPct:(hold/10000-1)*100,maxDrawdown,trades,curve,limitation:'בדיקה על סגירות יומיות בלבד; אינה משחזרת עצירה תוך־יומית של 1% או ביצוע בזמן אמת.'};
}

