import {backtestWyckoff} from './wyckoff-backtest.mjs';
import {evaluateWaveStrategy} from './meitav-wave-strategy.mjs';
import {evaluateWyckoff,createWyckoffTrade,wyckoffExit} from './wyckoff-strategy.mjs';
export const RULES=Object.freeze({maxPositions:6,minWave:3,maxWave:8,maPeriod:200,sellRetraceRatio:0.15,trailingStopPct:1});
export function normalizeBars(rows){
 if(!Array.isArray(rows))throw Error('נדרשת סדרת נתונים');
 const seen=new Set();
 const bars=rows.map(r=>{const date=String(r.date??r.datetime??'').slice(0,10),close=Number(r.close);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||!(close>0)||seen.has(date))throw Error('תאריך או מחיר לא תקינים, או תאריך כפול');
  seen.add(date);return {date,close,...(r.high!=null||r.low!=null?{open:Number(r.open??close),high:Number(r.high),low:Number(r.low)}:{})};}).sort((a,b)=>a.date.localeCompare(b.date));
 if(bars.length<3)throw Error('נדרשים לפחות 3 נרות יומיים סגורים');
 return bars;
}
export function createPaper(initial=10000,currency='USD',feePct=0.1){
 if(!Number.isFinite(initial)||initial<=0||!['USD','ILS'].includes(currency)||!Number.isFinite(feePct)||feePct<0||feePct>5)throw Error('הגדרות תיק לא תקינות');
 return {version:1,initial,currency,feePct,cash:initial,positions:{},journal:[]};
}
export function paperValue(p,prices={}){return p.cash+Object.values(p.positions).reduce((s,x)=>s+x.qty*(prices[x.symbol]||x.lastPrice||x.entryPrice),0);}
export function runPaperCycle(p,markets){
 p.usedPatterns??={};
 const available=markets.filter(m=>m.currency===p.currency&&m.bars?.length>=3);
 const evaluations=available.map(m=>({...m,bars:normalizeBars(m.bars),strategy:evaluateWyckoff(normalizeBars(m.bars))}));
 const sold=new Set(),fee=p.feePct/100;
 for(const m of evaluations){const x=p.positions[m.symbol];if(!x)continue;const date=m.bars.at(-1).date,price=m.bars.at(-1).close;
  if(date<=x.lastDate)continue;
  x.lastDate=date;x.lastPrice=price;x.peakPrice=Math.max(x.peakPrice,price);
  const exit=wyckoffExit(x,price);
  if(exit.sell){
   const proceeds=x.qty*price*(1-fee);p.cash+=proceeds;
   p.journal.unshift({type:'SELL',symbol:m.symbol,date,price,amount:proceeds,pnl:proceeds-x.cost,reason:exit.reason,patternId:x.patternId});
   delete p.positions[m.symbol];sold.add(m.symbol);
  }
 }
 for(const m of evaluations.filter(m=>m.strategy.buyConfirmed).sort((a,b)=>a.symbol.localeCompare(b.symbol))){
  if(p.positions[m.symbol]||sold.has(m.symbol))continue;
  const free=RULES.maxPositions-Object.keys(p.positions).length;if(free<=0)break;
  const date=m.bars.at(-1).date;
  if(p.journal.some(j=>j.symbol===m.symbol&&j.date>=date))continue;
  if(p.journal.some(j=>j.symbol===m.symbol&&j.patternId===m.strategy.patternId))continue;
  if(p.usedPatterns[m.symbol]?.includes(m.strategy.patternId))continue;
  const amount=p.cash/free,price=m.bars.at(-1).close,qty=amount/(price*(1+fee));
  if(amount<=0)continue;
  const trade=createWyckoffTrade(m.strategy,price);
  (p.usedPatterns[m.symbol]??=[]).push(trade.patternId);
  p.cash-=amount;p.positions[m.symbol]={symbol:m.symbol,qty,entryPrice:price,cost:amount,peakPrice:price,lastPrice:price,lastDate:date,entryDate:date,...trade};
  p.journal.unshift({type:'BUY',symbol:m.symbol,date,price,amount,reason:'חצייה מעל השפל הראשון לאחר Spring יומי',...trade});
 }
 p.journal=p.journal.slice(0,500);return evaluations;
}
export function backtestDaily(rows,feePct=.1){return backtestWyckoff(normalizeBars(rows),feePct);}

export function restorePaperState(s){
 const p=s?.paper;
 if(p?.version!==1||!Array.isArray(s.markets))throw Error('תיק שמור לא תקין');
 createPaper(p.initial,p.currency,p.feePct);
 if(!Number.isFinite(p.cash)||p.cash<0||!p.positions||Array.isArray(p.positions)||!Array.isArray(p.journal)||Object.keys(p.positions).length>6)throw Error('תיק שמור לא תקין');
 for(const [symbol,x] of Object.entries(p.positions)){
  if(x.symbol!==symbol||!['qty','entryPrice','cost','peakPrice','lastPrice'].every(k=>Number.isFinite(x[k])&&x[k]>0)||!/^\d{4}-\d{2}-\d{2}$/.test(x.lastDate))throw Error('פוזיציה שמורה לא תקינה');
 }
 const seen=new Set();
 for(const m of s.markets){if(!/^[A-Z][A-Z0-9.\-]{0,11}$/.test(m.symbol)||seen.has(m.symbol)||m.currency!==p.currency)throw Error('נתוני מניה שמורים לא תקינים');seen.add(m.symbol);m.bars=normalizeBars(m.bars);}
 return s;
}
