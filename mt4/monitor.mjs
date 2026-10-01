import {score} from '../lib/agent.mjs';
export function trackRisk(state,profit){
 if(!state||![state.startProfit,state.high,profit].every(Number.isFinite))throw Error('Invalid risk tracking');
 const equity=150+profit-state.startProfit,high=Math.max(state.high,equity);
 return {...state,equity,high,halted:state.halted===true||equity<=high*.85};
}
export function analyzeQuotes(symbols,now=Date.now()/1000){
 const target=Math.floor(now/300)*300-300;
 return symbols.map(x=>{
  const base={symbol:x.symbol,description:x.description,bid:x.bid,ask:x.ask,contractSize:x.contractSize,minLot:x.minLot,lotStep:x.lotStep,currency:x.profitCurrency,source:'MT4 / TGLColmex-Live',tickTime:x.tickTime};
  if(!Number.isFinite(x.tickTime)||now-x.tickTime>90||x.tickTime>now+5)return {...base,status:'stale',reason:'מחיר אינו עדכני; אין אות מאומת'};
  const bars=x.bars;
  if(!Array.isArray(bars)||bars.length<27||bars[0].time!==target||bars.some((b,i)=>!Number.isFinite(b.close)||b.close<=0||!Number.isInteger(b.time)||b.time!==target-i*300))return {...base,status:'waiting',reason:'נדרשים 27 נרות M5 סגורים ורצופים'};
  const scores=[0,1,2].map(i=>score(bars.slice(i))),current=scores[0];
  const kind=current.master>=60?'positive':current.master<40?'negative':'neutral';
  const confirmed=kind!=='neutral'&&scores.every(s=>kind==='positive'?s.master>=60:s.master<40);
  return {...base,status:'current',kind,confirmed,barTime:target,score:current.master,components:{trend:current.trend,momentum:current.momentum,risk:current.risk,market:current.market},reason:kind==='positive'?'ציון 60 ומעלה בשלושת הנרות האחרונים':kind==='negative'?'ציון מתחת ל־40 בשלושת הנרות האחרונים':'אין אות כיווני לפי ספי הסוכנים',quoteRisk:current.risk<40};
 });
}
export function prepareOrder(quote,side,lots,positions,now=Date.now()/1000,quotes=[quote]){
 if(!quote||quote.status!=='current'||!Number.isFinite(quote.tickTime)||now-quote.tickTime>90||quote.tickTime>now+5)throw Error('נדרש מחיר עדכני');
 if(!['buy','sell'].includes(side)||!Number.isFinite(lots)||lots<=0||quote.currency!=='USD')throw Error('פקודה או מטבע אינם נתמכים');
 if(!Number.isFinite(quote.minLot)||quote.minLot<=0||!Number.isFinite(quote.lotStep)||quote.lotStep<=0||lots<quote.minLot||Math.abs(lots/quote.lotStep-Math.round(lots/quote.lotStep))>1e-6)throw Error('כמות אינה תואמת למפרט הברוקר');
 const price=side==='buy'?quote.ask:quote.bid;
 if(!Number.isFinite(price)||price<=0||quote.contractSize!==1)throw Error('מפרט מניה אינו תקין');
 const notional=lots*price*quote.contractSize;
 if(side==='buy'){
  const held=positions.filter(p=>p.type===0).reduce((s,p)=>{
   const spec=quotes.find(q=>q.symbol===p.symbol);
   if(!spec||spec.currency!=='USD'||spec.contractSize!==1||!Number.isFinite(spec.ask)||spec.ask<=0||!Number.isFinite(p.lots)||p.lots<=0||!Number.isFinite(spec.tickTime)||now-spec.tickTime>90||spec.tickTime>now+5)throw Error('חסר מחיר או מפרט עדכני להחזקה קיימת; לא ניתן לבדוק את התקציב');
   return s+p.lots*spec.ask;
  },0);
  if(held+notional>120+.0001)throw Error('הכמות חורגת מיעד חשיפה של 120 דולר, כולל ההחזקות הקיימות בחשבון');
 }else{
  const owned=positions.filter(p=>p.symbol===quote.symbol&&p.type===0).reduce((s,p)=>s+p.lots,0);
  if(lots>owned+1e-8)throw Error('כמות המכירה עולה על ההחזקה; אין פתיחת שורט');
 }
 return {symbol:quote.symbol,side,lots,price,estimatedNotional:notional,currency:'USD',executionEnabled:false};
}

