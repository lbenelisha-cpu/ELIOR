const number=v=>v===null||v===undefined||typeof v==='boolean'||String(v).trim()===''?null:Number.isFinite(Number(v))?Number(v):null;
export function stockScenario(input){
 const keys=['amount','entry','target','stop','buyFee','sellFee','slippagePct'],v=Object.fromEntries(keys.map(k=>[k,number(input[k])]));
 if(Object.values(v).some(x=>x===null))return {error:'יש למלא גם את אומדן העמלות וההחלקה. אפס מציין חישוב ללא העלות הזו.'};
 if(!(v.amount>0&&v.entry>0&&v.stop>0&&v.stop<v.entry&&v.target>v.entry)||v.buyFee<0||v.sellFee<0||v.slippagePct<0||v.slippagePct>10)return {error:'נדרשים סכום חיובי, יעד מעל הכניסה, סטופ מתחתיה ועלויות שאינן שליליות.'};
 // Whole-share illustration only; actual broker lot rules govern an order.
 const quantity=Math.floor((v.amount-v.buyFee)/v.entry);if(quantity<1)return {error:'הסכום אינו מספיק למניה שלמה ולעמלת הקנייה.'};
 const cost=quantity*v.entry,drag=1-v.slippagePct/100,debit=cost+v.buyFee;
 const targetPnl=quantity*v.target*drag-debit-v.sellFee,stopPnl=quantity*v.stop*drag-debit-v.sellFee;
 const result={quantity,cost,debit,unused:v.amount-debit,targetPnl,stopPnl,breakEven:(debit+v.sellFee)/(quantity*drag),ratio:targetPnl>0&&stopPnl<0?targetPnl/-stopPnl:null};
 return Object.values(result).some(x=>x!==null&&!Number.isFinite(x))?{error:'הערכים גדולים מדי לחישוב.'}:result;
}
export function protectionView(position,pending=[],now=Date.now()){
 const p=position?.brokerProtection,at=number(p?.verifiedAt);
 if(!p||at===null||at>now+5000||now-at>120000)return {kind:'unknown',label:'הגנה לא אומתה לאחרונה',stop:null,target:null};
 const stop=number(p.stopLoss),target=number(p.takeProfit);
 if(!(stop>0))return {kind:'warning',label:'חסר סטופ מאושר בברוקר',stop:null,target};
 if(pending.some(i=>i.symbol===position.symbol))return {kind:'pending',label:'סטופ קיים · פעולה ממתינה לאישור',stop,target};
 return {kind:'good',label:'סטופ אומת בברוקר',stop,target};
}
export function closedTradeSummary(trades=[]){
 const known=trades.filter(t=>number(t.grossPnl)!==null&&!t.accountingAdjusted);
 return {count:trades.length,known:known.length,gross:known.reduce((sum,t)=>sum+Number(t.grossPnl),0),net:null};
}
export function marketHealthView(market,now=Date.now()){
 if(!market)return {kind:'unknown',label:'ממתין לנתוני השוק'};
 if(!market.ok)return {kind:'warning',label:'נתוני השוק מתעכבים'};
 if(market.cacheState==='PROVIDER_UNAVAILABLE_CACHE')return {kind:'warning',label:'נתוני גרף קודמים · '+({RATE_LIMIT:'ממתין למכסת קולמקס',TOKEN_EXPIRED:'החיבור מתחדש',AUTH_DENIED:'ההתחברות נדחתה',ACCESS_DENIED:'חסרה הרשאת שוק',BROKER_NOT_READY:'חיבור קולמקס מתעדכן',BROKER_ERROR_RESPONSE:'שגיאה בתשובת קולמקס',SESSION_BUSY:'החיבור מתחדש',SESSION_STORE_UNAVAILABLE:'שירות החיבור מתעכב',NETWORK:'קולמקס לא השיבה בזמן'}[market.providerErrorCode]||'הספק מתעכב')};
 if(market.cacheState==='MARKET_CLOSED_CACHE')return {kind:'unknown',label:'השוק סגור · נתוני גרף שמורים'};
 const at=Date.parse(market.observedAt||market.priceAt);
 if(!Number.isFinite(at)||at>now+5000||now-at>180000)return {kind:'warning',label:'נתוני גרף קודמים · ממתין לרענון'};
 return {kind:'good',label:'נתוני גרף התקבלו לאחרונה'};
}
