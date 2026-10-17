// Read-only counterfactual study. Real entries, fixed horizons, closed-bar signals,
// next available open fills. No use of a subsequently known global maximum.
export const EXIT_STUDY_VARIANTS=[
 {id:'week80',label:'הכלל הקיים: שבוע, שמירת 80%',holdMs:7*86400000,retain:.8,armPct:0},
 {id:'now80',label:'80% מהרווח, ללא המתנה',holdMs:0,retain:.8,armPct:0},
 {id:'15m80',label:'80% מהרווח, המתנה 15 דקות',holdMs:900000,retain:.8,armPct:0},
 {id:'1h80',label:'80% מהרווח, המתנה שעה',holdMs:3600000,retain:.8,armPct:0},
 {id:'15m50plain',label:'50% מהרווח, המתנה 15 דקות',holdMs:900000,retain:.5,armPct:0},
 {id:'15m30plain',label:'30% מהרווח, המתנה 15 דקות',holdMs:900000,retain:.3,armPct:0},
 {id:'15m50',label:'50% מהרווח, הפעלה ב־1%, 15 דקות',holdMs:900000,retain:.5,armPct:1},
 {id:'15m30',label:'30% מהרווח, הפעלה ב־1%, 15 דקות',holdMs:900000,retain:.3,armPct:1},
 {id:'15mprice1',label:'נסיגה 1% מהשיא, הפעלה ב־1%, 15 דקות',holdMs:900000,trailPct:1,armPct:1}
];
export function simulateExit(entry,candles,variant,{horizonMs=86400000,feeRate=.001,exitSlippage=.0005}={}){
 const time=Date.parse(entry.at),price=Number(entry.price),cost=Number(entry.amountUsdt),end=time+horizonMs;
 if(!(price>0)||!(cost>0)||!Number.isFinite(time))throw Error('INVALID_STUDY_ENTRY');
 const bars=candles.filter(b=>b.closed!==false).sort((a,b)=>a.openTime-b.openTime);
 if(!bars.length||bars[0].openTime>time||bars.at(-1).openTime<end)return {covered:false};
 const relevant=bars.filter(b=>b.closeTime>=time&&b.openTime<=end+300000);
 if(relevant.some((b,i)=>![b.open,b.close].every(v=>Number.isFinite(Number(v))&&Number(v)>0)||(i>0&&b.openTime-relevant[i-1].openTime!==300000)))return {covered:false};
 const path=bars.filter(b=>b.openTime>time&&b.openTime<=end+300000);
 let peak=price,peakAt=time,pending=null,exit=null,observed=[];
 for(const b of path){
  if(pending){exit={price:Number(b.open)*(1-exitSlippage),at:Number(b.openTime),reason:pending};break;}
  if(b.openTime>=end){exit={price:Number(b.open)*(1-exitSlippage),at:Number(b.openTime),reason:'HORIZON_MARK'};break;}
  // Only closes define the running high: a five-minute wick is not a sampled tick.
  const close=Number(b.close);if(close>peak){peak=close;peakAt=Number(b.closeTime);}
  observed.push({at:b.closeTime,close,peak});
  if(close<=price*.9)pending='STOP_10';
  else if(b.closeTime>=time+variant.holdMs&&(peak/price-1)*100>=variant.armPct){
   const floor=variant.trailPct?peak*(1-variant.trailPct/100):price+variant.retain*(peak-price);
   if(peak>price&&close<=floor)pending='TRAIL';
  }
 }
 if(!exit)return {covered:false};
 const quantity=cost*(1-feeRate)/price,proceeds=quantity*exit.price*(1-feeRate),net=proceeds-cost;
 const full=bars.filter(b=>b.openTime>time&&b.closeTime<=end),best=full.reduce((p,b)=>Number(b.close)>p.price?{price:Number(b.close),at:b.closeTime}:p,{price,at:time});
 return {covered:true,symbol:entry.symbol,entryAt:entry.at,entryPrice:price,cost,exit,net,netPct:100*net/cost,peakPrice:peak,peakAt,fullHorizonBest:best,observed};
}
