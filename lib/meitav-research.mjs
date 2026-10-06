import {normalizeBars,RULES} from './meitav-paper.mjs';
import {evaluateWaveStrategy} from './meitav-wave-strategy.mjs';

export const METHODS=Object.freeze([
 {id:'wave',name:'הגלים הקיימים',rule:'גל 3%–8% מעל MA200; יציאה בעצירה 1% או נסיגה 15%'},
 {id:'ma200',name:'מעקב MA200',rule:'מחזיקים כשהסגירה מעל MA200; יוצאים כשהיא בגובה הממוצע או מתחתיו'},
 {id:'maCross',name:'ממוצעים 50 / 200',rule:'מחזיקים כאשר MA50 גבוה מ־MA200; אחרת מזומן'},
 {id:'momentum',name:'מומנטום 12 חודשים',rule:'בתחילת חודש: מחזיקים אם שינוי המחיר ב־252 ימי מסחר חיובי; אחרת מזומן'}
].map(Object.freeze));
const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;

export function methodSignals(rows,id){
 const bars=normalizeBars(rows);if(!METHODS.some(m=>m.id===id))throw Error('שיטה לא מוכרת');
 const sums=[0];for(const b of bars)sums.push(sums.at(-1)+b.close);
 return bars.map((b,i)=>{
  if(i<252)return null;
  const ma200=(sums[i+1]-sums[i-199])/200,ma50=(sums[i+1]-sums[i-49])/50;
  if(id==='wave'){const s=evaluateWaveStrategy(bars.slice(0,i+1),RULES);return {buy:s.buyConfirmed,sell:s.sellConfirmed,stop:1};}
  const active=id==='ma200'?b.close>ma200:id==='maCross'?ma50>ma200:b.close>bars[i-252].close;
  const decision=id!=='momentum'||b.date.slice(0,7)!==bars[i-1].date.slice(0,7);
  return {buy:decision&&active,sell:decision&&!active,stop:null};
 });
}

export function simulateMethod(rows,id,{feePct=.1,slippagePct=.05,startDate,endDate}={}){
 for(const n of [feePct,slippagePct])if(!Number.isFinite(n)||n<0||n>5)throw Error('עמלה או עלות ביצוע לא תקינה');
 const bars=normalizeBars(rows),series=methodSignals(bars,id),indices=bars.map((b,i)=>i>=252&&(!startDate||b.date>=startDate)&&(!endDate||b.date<=endDate)?i:-1).filter(i=>i>=0);
 if(indices.length<2)throw Error('אין מספיק ימים בתקופת הבדיקה');
 const fee=feePct/100,slip=slippagePct/100;let cash=10000,qty=0,peak=0,top=10000,dd=0,pending=null,daysHeld=0,cost=0,closed=0,wins=0,totalFees=0;
 const curve=[],journal=[],first=indices[0],last=indices.at(-1),holdQty=10000/(bars[first].close*(1+slip)*(1+fee));let holdTop=10000,holdDD=0;
 for(const i of indices){const {date,close:price}=bars[i];
  if(pending?.type==='BUY'&&!qty){const execution=price*(1+slip);cost=cash;qty=cash/(execution*(1+fee));const fees=qty*execution*fee;totalFees+=fees;cash=0;peak=price;journal.push({type:'BUY',date,signalDate:pending.date,price:execution,fee:fees});}
  if(pending?.type==='SELL'&&qty){const execution=price*(1-slip),fees=qty*execution*fee;totalFees+=fees;cash=qty*execution-fees;const pnl=cash-cost;closed++;if(pnl>0)wins++;qty=0;journal.push({type:'SELL',date,signalDate:pending.date,price:execution,fee:fees,pnl,reason:pending.reason});}
  pending=null;const s=series[i];
  if(qty){daysHeld++;peak=Math.max(peak,price);const stopped=s.stop!==null&&price<=peak*(1-s.stop/100);if(stopped||s.sell)pending={type:'SELL',date,reason:stopped?'עצירה מהשיא בסגירה':'תנאי היציאה של השיטה'};}
  else if(s.buy)pending={type:'BUY',date};
  const value=cash+qty*price,hold=holdQty*price;top=Math.max(top,value);dd=Math.max(dd,(top-value)/top*100);holdTop=Math.max(holdTop,hold);holdDD=Math.max(holdDD,(holdTop-hold)/holdTop*100);curve.push({date,value,hold});
 }
 const value=curve.at(-1).value,returnPct=(value/10000-1)*100,holdReturnPct=(curve.at(-1).hold/10000-1)*100;
 return {startDate:bars[first].date,endDate:bars[last].date,days:indices.length,value,returnPct,holdReturnPct,excessPct:returnPct-holdReturnPct,maxDrawdown:dd,holdMaxDrawdown:holdDD,actions:journal.length,closedTrades:closed,winRate:closed?wins/closed*100:null,fees:totalFees,exposurePct:daysHeld/indices.length*100,openPosition:qty>0,curve,journal};
}

export function compareMethods(markets,{feePct=.1,slippagePct=.05}={}){
 if(!Array.isArray(markets)||markets.length<3)throw Error('טען לפחות שלוש מניות למחקר משותף');
 const seen=new Set(),currency=markets[0].currency;
 const data=markets.map(m=>{if(!/^[A-Z][A-Z0-9.\-]{0,11}$/.test(m.symbol)||seen.has(m.symbol)||!['USD','ILS'].includes(m.currency)||m.currency!==currency)throw Error('נדרשים סימולים שונים ובאותו מטבע');seen.add(m.symbol);return {...m,bars:normalizeBars(m.bars)};});
 const sets=data.map(m=>new Set(m.bars.slice(252).map(b=>b.date))),common=data[0].bars.slice(252).map(b=>b.date).filter(d=>sets.every(s=>s.has(d)));
 if(common.length<180)throw Error('נדרשים לפחות 180 תאריכים משותפים לאחר 252 ימי חימום. טען היסטוריה ארוכה יותר');
 const a=Math.floor(common.length*.6),b=Math.floor(common.length*.8),periods=[{id:'train',name:'בחירת שיטה',startDate:common[0],endDate:common[a-1]},{id:'test1',name:'בדיקה א׳',startDate:common[a],endDate:common[b-1]},{id:'test2',name:'בדיקה ב׳',startDate:common[b],endDate:common.at(-1)}];
 const results=METHODS.map(method=>{
  const assets=data.map(m=>({symbol:m.symbol,source:m.source||'לא צוין',periods:periods.map(p=>({id:p.id,...simulateMethod(m.bars,method.id,{feePct,slippagePct,...p})}))}));
  const summary=periods.map((p,i)=>{const r=assets.map(m=>m.periods[i]);return {id:p.id,meanReturn:avg(r.map(x=>x.returnPct)),meanHold:avg(r.map(x=>x.holdReturnPct)),meanDrawdown:avg(r.map(x=>x.maxDrawdown)),meanHoldDrawdown:avg(r.map(x=>x.holdMaxDrawdown)),positiveAssets:r.filter(x=>x.returnPct>0).length,beatingAssets:r.filter(x=>x.excessPct>0).length,actions:r.reduce((n,x)=>n+x.actions,0)};});
  // An explicit research criterion, not a statistical proof or an optimized risk preference.
  const score=summary[0].meanReturn-.5*summary[0].meanDrawdown;
  return {method,assets,summary,score};
 }).sort((a,b)=>b.score-a.score||a.method.id.localeCompare(b.method.id));
 return {currency,feePct,slippagePct,periods,datasets:data,symbols:data.map(m=>m.symbol),selectedId:results[0].method.id,selection:'ממוצע תשואה פחות חצי מממוצע הירידה המרבית בתקופת הבחירה בלבד',results};
}
