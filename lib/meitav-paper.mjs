import {evaluateWaveStrategy} from './meitav-wave-strategy.mjs';
export const RULES=Object.freeze({maxPositions:6,minWave:3,maxWave:8,maPeriod:200,sellRetraceRatio:0.15,trailingStopPct:1});
export function normalizeBars(rows){
 if(!Array.isArray(rows))throw Error('נדרשת סדרת נתונים');
 const seen=new Set();
 const bars=rows.map(r=>{const date=String(r.date??r.datetime??'').slice(0,10),close=Number(r.close);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||!(close>0)||seen.has(date))throw Error('תאריך או מחיר לא תקינים, או תאריך כפול');
  seen.add(date);return {date,close};}).sort((a,b)=>a.date.localeCompare(b.date));
 if(bars.length<203)throw Error('נדרשים לפחות 203 נרות יומיים סגורים לחישוב MA200');
 return bars;
}
export function createPaper(initial=10000,currency='USD',feePct=0.1){
 if(!Number.isFinite(initial)||initial<=0||!['USD','ILS'].includes(currency)||!Number.isFinite(feePct)||feePct<0||feePct>5)throw Error('הגדרות תיק לא תקינות');
 return {version:1,initial,currency,feePct,cash:initial,positions:{},journal:[]};
}
export function paperValue(p,prices={}){return p.cash+Object.values(p.positions).reduce((s,x)=>s+x.qty*(prices[x.symbol]||x.lastPrice||x.entryPrice),0);}
export function runPaperCycle(p,markets){
 const available=markets.filter(m=>m.currency===p.currency&&m.bars?.length>=203);
 const evaluations=available.map(m=>({...m,bars:normalizeBars(m.bars),strategy:evaluateWaveStrategy(normalizeBars(m.bars),RULES)}));
 const sold=new Set(),fee=p.feePct/100;
 for(const m of evaluations){const x=p.positions[m.symbol];if(!x)continue;const date=m.bars.at(-1).date,price=m.bars.at(-1).close;
  if(date<=x.lastDate)continue;
  x.lastDate=date;x.lastPrice=price;x.peakPrice=Math.max(x.peakPrice,price);
  if(price<=x.peakPrice*(1-RULES.trailingStopPct/100)||m.strategy.sellConfirmed){
   const proceeds=x.qty*price*(1-fee);p.cash+=proceeds;
   p.journal.unshift({type:'SELL',symbol:m.symbol,date,price,amount:proceeds,pnl:proceeds-x.cost,reason:price<=x.peakPrice*.99?'ירידה של 1% מהשיא שנדגם':'אות גל יורד'});
   delete p.positions[m.symbol];sold.add(m.symbol);
  }
 }
 for(const m of evaluations.filter(m=>m.strategy.buyConfirmed).sort((a,b)=>b.strategy.currentWave-a.strategy.currentWave||a.symbol.localeCompare(b.symbol))){
  if(p.positions[m.symbol]||sold.has(m.symbol))continue;
  const free=RULES.maxPositions-Object.keys(p.positions).length;if(free<=0)break;
  const date=m.bars.at(-1).date;
  if(p.journal.some(j=>j.symbol===m.symbol&&j.date>=date))continue;
  const amount=p.cash/free,price=m.bars.at(-1).close,qty=amount/(price*(1+fee));
  if(amount<=0)continue;
  p.cash-=amount;p.positions[m.symbol]={symbol:m.symbol,qty,entryPrice:price,cost:amount,peakPrice:price,lastPrice:price,lastDate:date,entryDate:date};
  p.journal.unshift({type:'BUY',symbol:m.symbol,date,price,amount,reason:'גל עולה 3%–8%, חזק מהירידה הקודמת ומעל MA200'});
 }
 p.journal=p.journal.slice(0,500);return evaluations;
}
export function backtestDaily(rows,feePct=0.1){
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
