import {normalizeBars,RULES} from './meitav-paper.mjs';
import {evaluateWaveStrategy} from './meitav-wave-strategy.mjs';

export const SCENARIOS=Object.freeze([
 {id:'base',name:'כללים קיימים',stop:1,retrace:.15,min:3,exit:'wave'},
 {id:'stop2',name:'עצירה 2%',stop:2,retrace:.15,min:3,exit:'wave'},
 {id:'stop3',name:'עצירה 3%',stop:3,retrace:.15,min:3,exit:'wave'},
 {id:'stop5',name:'עצירה 5%',stop:5,retrace:.15,min:3,exit:'wave'},
 {id:'wave30',name:'נסיגת גל 30%',stop:1,retrace:.30,min:3,exit:'wave'},
 {id:'both',name:'עצירה 3% ונסיגה 30%',stop:3,retrace:.30,min:3,exit:'wave'},
 {id:'stopOnly',name:'עצירה 3% בלבד',stop:3,retrace:null,min:3,exit:'none'},
 {id:'maExit',name:'עצירה 3% או ירידה מתחת MA200',stop:3,retrace:null,min:3,exit:'ma'},
 {id:'entry1',name:'כניסה מגל 1%',stop:3,retrace:.30,min:1,exit:'wave'}
].map(Object.freeze));

function signals(bars,cfg){return bars.map((_,i)=>i<202?null:evaluateWaveStrategy(bars.slice(0,i+1),{...RULES,minWave:cfg.min,sellRetraceRatio:cfg.retrace??.15}));}
function segment(bars,series,cfg,feePct,start,end){
 const fee=feePct/100;let cash=10000,qty=0,peak=0,top=10000,drawdown=0,pending=null,cost=0,wins=0,closed=0,fees=0;
 const curve=[],journal=[];
 for(let i=start;i<=end;i++){
  const {date,close:price}=bars[i];
  if(pending?.type==='BUY'&&qty===0){cost=cash;qty=cost/(price*(1+fee));const entryFee=qty*price*fee;fees+=entryFee;cash=0;peak=price;journal.push({type:'BUY',date,price,qty,fee:entryFee,signalDate:pending.date,reason:'גל עולה בטווח שנבחר, חזק מהירידה הקודמת ומעל MA200'});}
  if(pending?.type==='SELL'&&qty>0){const exitFee=qty*price*fee;cash=qty*price-exitFee;fees+=exitFee;const pnl=cash-cost;closed++;if(pnl>0)wins++;journal.push({type:'SELL',date,price,qty,fee:exitFee,pnl,signalDate:pending.date,reason:pending.reason});qty=0;}
  pending=null;const s=series[i];
  if(qty>0){peak=Math.max(peak,price);const stop=price<=peak*(1-cfg.stop/100),wave=cfg.exit==='wave'&&s.sellConfirmed,ma=cfg.exit==='ma'&&!s.aboveMA;
   if(stop||wave||ma)pending={type:'SELL',date,reason:stop?'ירידה של '+cfg.stop+'% מהשיא בסגירה':wave?'נסיגה של '+cfg.retrace*100+'% מהגל הקודם':'מחיר בסגירה בגובה MA200 או מתחתיו'};
  }else if(s.buyConfirmed)pending={type:'BUY',date};
  const value=cash+qty*price;top=Math.max(top,value);drawdown=Math.max(drawdown,(top-value)/top*100);curve.push({date,value});
 }
 const value=cash+qty*bars[end].close,hold=10000/(bars[start].close*(1+fee))*bars[end].close;
 return {startDate:bars[start].date,endDate:bars[end].date,value,returnPct:(value/10000-1)*100,holdReturnPct:(hold/10000-1)*100,maxDrawdown:drawdown,actions:journal.length,closedTrades:closed,winRate:closed?wins/closed*100:null,fees,openPosition:qty>0,curve,journal};
}
export function compareScenarios(rows,feePct=.1){
 if(!Number.isFinite(feePct)||feePct<0||feePct>5)throw Error('עמלה לא תקינה');
 const bars=normalizeBars(rows),days=bars.length-202;
 if(days<60)throw Error('נדרשים לפחות 262 נרות: 202 לחימום ולפחות 60 להשוואה');
 const split=202+Math.floor(days*.7);
 const results=SCENARIOS.map(cfg=>{const series=signals(bars,cfg);return {scenario:cfg,train:segment(bars,series,cfg,feePct,202,split-1),validation:segment(bars,series,cfg,feePct,split,bars.length-1)};});
 results.sort((a,b)=>b.train.returnPct-a.train.returnPct||a.train.maxDrawdown-b.train.maxDrawdown||a.scenario.id.localeCompare(b.scenario.id));
 return {feePct,selection:'תשואה גבוהה בתקופת ההשוואה; בשוויון ירידה מרבית נמוכה יותר',selectedId:results[0].scenario.id,trainDays:split-202,validationDays:bars.length-split,results};
}
