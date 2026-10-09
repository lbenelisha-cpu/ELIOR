import {evaluateWyckoff,createWyckoffTrade,wyckoffExit} from './wyckoff-strategy.mjs';
// Close-only simulation executes a confirmed signal at the following available close.
// It never fabricates fills at target/stop prices when the market gaps across them.
export function backtestWyckoff(bars,feePct=.1){
 if(!Number.isFinite(feePct)||feePct<0||feePct>5)throw Error('INVALID_FEE');
 evaluateWyckoff(bars);
 const fee=feePct/100;let cash=10000,qty=0,position=null,pending=null,top=10000,maxDrawdown=0;
 const curve=[],journal=[];
 for(let i=2;i<bars.length;i++){
  const price=Number(bars[i].close),date=bars[i].date||bars[i].closeTime;
  if(pending?.type==='SELL'&&qty){cash=qty*price*(1-fee);journal.push({type:'SELL',date,price,reason:pending.reason,...position});qty=0;position=null;}
  else if(pending?.type==='BUY'&&!qty&&price>pending.setup.firstLow.price&&price<pending.setup.targetPrice){
   position=createWyckoffTrade(pending.setup,price);qty=cash/(price*(1+fee));cash=0;journal.push({type:'BUY',date,price,...position});
  }
  pending=null;
  if(qty){const exit=wyckoffExit(position,price);if(exit.sell)pending={type:'SELL',reason:exit.reason};}
  else{const s=evaluateWyckoff(bars.slice(0,i+1));if(s.buyConfirmed)pending={type:'BUY',setup:s};}
  const value=cash+qty*price;top=Math.max(top,value);maxDrawdown=Math.max(maxDrawdown,(top-value)/top*100);curve.push({date,value});
 }
 const value=curve.at(-1).value,hold=10000/(Number(bars[2].close)*(1+fee))*Number(bars.at(-1).close);
 return {value,returnPct:(value/10000-1)*100,holdReturnPct:(hold/10000-1)*100,maxDrawdown,trades:journal.length,curve,journal,
  limitation:'סגירות יומיות בלבד; אות מבוצע בסגירה הבאה. יעד: שיא ראשוני × 1.07; עצירה: מחיר ביצוע × 0.94. אין שחזור של חצייה או מילוי תוך־יומיים.'};
}
