import {evaluateWaveStrategy} from './binance-wave-agent.mjs';
import {normalizeCryptoBars,DAY} from './binance-research-data.mjs';
export const CRYPTO_METHODS=Object.freeze([
 {id:'wave',name:'גלים · בסיס יומי',rule:'גל 3%–8% מעל MA200; מכירה בעצירה 1% מהשיא בסגירה או נסיגה 15% מהגל'},
 {id:'ma200',name:'מעקב MA200',rule:'קנייה מעל MA200; מכירה בגובה MA200 או מתחתיו'},
 {id:'cross',name:'ממוצעים 50/200',rule:'קנייה כאשר MA50 גבוה מ־MA200; מכירה כאשר אינו גבוה ממנו'}
].map(Object.freeze));
export function prepareCrypto(markets){
 if(!Array.isArray(markets)||markets.length<3||markets.length>12)throw Error('נדרשים 3–12 מטבעות למחקר');
 const seen=new Set();return markets.map(m=>{if(!/^[A-Z0-9]{2,16}USDT$/.test(m.symbol)||seen.has(m.symbol))throw Error('סימול לא תקין או כפול');seen.add(m.symbol);return {...m,bars:normalizeCryptoBars(m.bars)};});
}
function signals(bars,method){
 const sums=[0];for(const b of bars)sums.push(sums.at(-1)+b.close);
 return bars.map((b,i)=>{
  if(i<202)return null;const momentum=(b.close/bars[i-90].close-1)*100;
  if(method==='wave'){const s=evaluateWaveStrategy(bars.slice(0,i+1),{minWave:3,maxWave:8,maPeriod:200,sellRetraceRatio:.15});return {buy:s.buyConfirmed,sell:s.sellConfirmed,stop:1,momentum};}
  const ma200=(sums[i+1]-sums[i-199])/200,ma50=(sums[i+1]-sums[i-49])/50,active=method==='ma200'?b.close>ma200:ma50>ma200;
  return {buy:active,sell:!active,stop:null,momentum};
 });
}
function validateOptions({initial=10000,feePct=.1,slippagePct=.05,maxPositions=6}={}){
 if(!Number.isFinite(initial)||initial<=0||!Number.isInteger(maxPositions)||maxPositions<1||maxPositions>6||![feePct,slippagePct].every(n=>Number.isFinite(n)&&n>=0&&n<=5))throw Error('הגדרות מחקר לא תקינות');
 return {initial,feePct,slippagePct,maxPositions};
}
function run(data,method,options,startDate,endDate,prepared){
 const methodName=CRYPTO_METHODS.find(x=>x.id===method).name;
 const {initial,feePct,slippagePct,maxPositions}=options,fee=feePct/100,slip=slippagePct/100;
 const maps=new Map(data.map(m=>[m.symbol,new Map(m.bars.map((b,i)=>[b.date,{...b,signal:prepared.get(m.symbol)[i]}]))]));
 const dates=data[0].bars.filter(b=>b.date>=startDate&&b.date<=endDate).map(b=>b.date);
 if(dates.length<2)throw Error('תקופת בדיקה קצרה מדי');
 let cash=initial,positions={},pending=[],peakEquity=initial,dd=0,fees=0,closed=0,wins=0,exposureDays=0,holdPeak=initial,holdDD=0;
 const journal=[],curve=[],holdSymbols=data.slice(0,maxPositions).map(m=>m.symbol),holdQty={};
 for(const symbol of holdSymbols)holdQty[symbol]=(initial/holdSymbols.length)/(maps.get(symbol).get(dates[0]).open*(1+slip)*(1+fee));
 for(const date of dates){
  const get=symbol=>{const b=maps.get(symbol)?.get(date);if(!b||!b.signal)throw Error('נתונים חסרים בתקופה המשותפת');return b;};
  for(const order of pending.filter(x=>x.type==='SELL')){const p=positions[order.symbol];if(!p)continue;const price=get(order.symbol).open*(1-slip),f=p.qty*price*fee,proceeds=p.qty*price-f,pnl=proceeds-p.cost;cash+=proceeds;fees+=f;closed++;if(pnl>0)wins++;journal.push({...order,date,price,amount:proceeds,fee:f,pnl,qty:p.qty});delete positions[order.symbol];}
  for(const order of pending.filter(x=>x.type==='BUY').sort((a,b)=>b.momentum-a.momentum||a.symbol.localeCompare(b.symbol))){
   if(positions[order.symbol])continue;const free=maxPositions-Object.keys(positions).length;if(free<=0||cash<=0)break;
   const amount=cash/free,price=get(order.symbol).open*(1+slip),qty=amount/(price*(1+fee)),f=qty*price*fee;
   cash-=amount;fees+=f;positions[order.symbol]={symbol:order.symbol,qty,cost:amount,entryPrice:price,peakClose:get(order.symbol).open};journal.push({...order,date,price,amount,fee:f,qty});
  }
  pending=[];
  for(const m of data){const b=get(m.symbol),p=positions[m.symbol],s=b.signal;
   if(p){p.peakClose=Math.max(p.peakClose,b.close);const stopped=s.stop!==null&&b.close<=p.peakClose*(1-s.stop/100);if(stopped||s.sell)pending.push({type:'SELL',symbol:m.symbol,signalDate:date,reason:stopped?'ירידה 1% מהשיא שנדגם בסגירה':'תנאי יציאה של '+methodName});}
   else if(s.buy)pending.push({type:'BUY',symbol:m.symbol,signalDate:date,momentum:s.momentum,reason:'תנאי כניסה של '+methodName});
  }
  const held=Object.keys(positions).length;if(held)exposureDays++;
  const value=cash+Object.values(positions).reduce((n,p)=>n+p.qty*get(p.symbol).close,0),hold=holdSymbols.reduce((n,s)=>n+holdQty[s]*get(s).close,0);
  peakEquity=Math.max(peakEquity,value);dd=Math.max(dd,(peakEquity-value)/peakEquity*100);holdPeak=Math.max(holdPeak,hold);holdDD=Math.max(holdDD,(holdPeak-hold)/holdPeak*100);
  curve.push({date,value,cash,held,hold});
 }
 const value=curve.at(-1).value;return {startDate,endDate,value,returnPct:(value/initial-1)*100,maxDrawdown:dd,holdReturnPct:(curve.at(-1).hold/initial-1)*100,holdMaxDrawdown:holdDD,holdSymbols,actions:journal.length,closedTrades:closed,winRate:closed?wins/closed*100:null,fees,exposurePct:exposureDays/dates.length*100,cash,positions,journal,curve};
}
export function simulateCryptoPortfolio(markets,method,opts={}){
 if(!CRYPTO_METHODS.some(x=>x.id===method))throw Error('שיטה לא מוכרת');
 const data=prepareCrypto(markets),options=validateOptions(opts),startDate=opts.startDate||data.map(m=>m.bars[202].date).sort().at(-1),endDate=opts.endDate||data.map(m=>m.bars.at(-1).date).sort()[0];
 if(startDate<data.map(m=>m.bars[202].date).sort().at(-1)||endDate>data.map(m=>m.bars.at(-1).date).sort()[0]||startDate>endDate)throw Error('תקופה מחוץ לכיסוי המשותף');
 return run(data,method,options,startDate,endDate,new Map(data.map(m=>[m.symbol,signals(m.bars,method)])));
}
export function compareCryptoPortfolios(markets,opts={}){
 const data=prepareCrypto(markets),options=validateOptions(opts),first=data.map(m=>m.bars[202].date).sort().at(-1),last=data.map(m=>m.bars.at(-1).date).sort()[0],count=Math.round((Date.parse(last)-Date.parse(first))/DAY)+1;
 if(count<180)throw Error('נדרשים לפחות 180 ימים משותפים לאחר חימום MA200; טען היסטוריה ארוכה יותר');
 const dates=Array.from({length:count},(_,i)=>new Date(Date.parse(first)+i*DAY).toISOString().slice(0,10)),a=Math.floor(count*.6),b=Math.floor(count*.8),periods=[{name:'בחירת שיטה',startDate:dates[0],endDate:dates[a-1]},{name:'בדיקה א׳',startDate:dates[a],endDate:dates[b-1]},{name:'בדיקה ב׳',startDate:dates[b],endDate:dates.at(-1)}];
 const results=CRYPTO_METHODS.map(method=>{const prepared=new Map(data.map(m=>[m.symbol,signals(m.bars,method.id)])),tests=periods.map(p=>run(data,method.id,options,p.startDate,p.endDate,prepared));return {method,tests,score:tests[0].returnPct-.5*tests[0].maxDrawdown};}).sort((a,b)=>b.score-a.score||a.method.id.localeCompare(b.method.id));
 return {...options,datasets:data,periods,selectedId:results[0].method.id,results};
}
