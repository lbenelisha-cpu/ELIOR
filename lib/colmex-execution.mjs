import {analyzeMarket,fingerprint} from './colmex-market.mjs';
export const CONFIG=Object.freeze({account:'102598',server:'TGLColmex-Demo',capital:10000,budget:5000,target:.8,barSeconds:300,minimumScore:60,advantage:10,confirmations:3,band:.02,minimumILS:100,magics:[31025981,31025982]});
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const safeSymbol=x=>typeof x==='string'&&/^[A-Za-z0-9_.#-]{1,64}$/.test(x);
const recent=(t,now,age)=>finite(t)&&t<=now+5&&t>=now-age;
export function validateSnapshot(d,now=Date.now()/1000){
 if(!d||d.account!==CONFIG.account||d.server!==CONFIG.server||d.tradeMode!==0||d.isDemo!==true||d.currency!=='USD'||!d.connected)throw Error('Verified USD demo required');
 if(!/^[a-zA-Z0-9-]{16,64}$/.test(d.clientId)||!Number.isSafeInteger(d.sequence)||d.sequence<1||!recent(d.capturedAt,now,120))throw Error('Invalid terminal identity or clock');
 for(const k of ['balance','equity','freeMargin'])if(!finite(d[k]))throw Error('Invalid account values');
 if(typeof d.enabled!=='boolean'||typeof d.historyOverflow!=='boolean'||!Number.isInteger(d.foreignOrders)||d.foreignOrders<0)throw Error('Invalid terminal state');
 if(!Array.isArray(d.orders)||d.orders.length>50||!Array.isArray(d.closed)||d.closed.length>500)throw Error('Invalid order count');
 const check=(o,closed)=>{
  if(!Number.isSafeInteger(o.ticket)||o.ticket<=0||!CONFIG.magics.includes(o.magic)||!safeSymbol(o.symbol)||o.type!==0)throw Error('Unsupported owned order');
  for(const k of ['lots','openPrice','profit','swap','commission'])if(!finite(o[k]))throw Error('Invalid order values');
  if(o.lots<=0||o.openPrice<=0)throw Error('Invalid order volume');
  if(closed&&(!finite(o.closeTime)||o.closeTime<=0||o.closeTime>now+120))throw Error('Invalid closed order time');
  return Object.fromEntries(['ticket','magic','symbol','type','lots','openPrice','profit','swap','commission',...(closed?['closeTime']:[])].map(k=>[k,o[k]]));
 };
 const orders=d.orders.map(o=>check(o,false)),closed=d.closed.map(o=>check(o,true));
 if(new Set(orders.map(o=>o.ticket)).size!==orders.length||new Set(closed.map(o=>o.ticket)).size!==closed.length||closed.some(o=>orders.some(p=>p.ticket===o.ticket)))throw Error('Duplicate ticket');
 let result=null;if(d.result){const r=d.result;if(!/^[a-f0-9-]{36}$/.test(r.id)||!['filled','rejected','uncertain'].includes(r.status)||!Number.isInteger(r.ticket)||!Number.isInteger(r.error))throw Error('Invalid acknowledgement');result={id:r.id,status:r.status,ticket:r.ticket,error:r.error};}
 return {account:d.account,server:d.server,tradeMode:0,isDemo:true,currency:'USD',connected:true,clientId:d.clientId,sequence:d.sequence,capturedAt:d.capturedAt,balance:d.balance,equity:d.equity,freeMargin:d.freeMargin,enabled:d.enabled,historyOverflow:d.historyOverflow,foreignOrders:d.foreignOrders,orders,closed,result};
}
export function quoteSpec(x,items,now=Date.now()/1000,{forEntry=true}={}){
 if(!x||!safeSymbol(x.symbol)||x.depositCurrency!=='USD'||![0,1].includes(x.profitMode))return {ok:false,reason:'שיטת חוזה או מטבע חשבון אינם נתמכים'};
 if(!recent(x.capturedAt,now,180)||!recent(x.tickTime,now,90)||!finite(x.ask)||!finite(x.bid)||x.bid<=0||x.ask<x.bid)return {ok:false,reason:'מחיר אינו עדכני'};
 for(const k of ['contractSize','tickSize','tickValue','minLot','lotStep'])if(!finite(x[k])||x[k]<=0)return {ok:false,reason:'מפרט חוזה חסר'};
 if(forEntry&&!x.tradeAllowed)return {ok:false,reason:'הנכס אינו פתוח למסחר'};
 let rate=1,fxSymbol='USD';
 if(x.profitCurrency==='ILS'){
  const fx=['USDILS#','USDILS'].map(s=>items[s]).find(v=>v&&recent(v.tickTime,now,60)&&recent(v.capturedAt,now,180)&&v.bid>0&&v.ask>=v.bid);
  if(!fx)return {ok:false,reason:'חסר שער דולר–שקל עדכני'};rate=1/fx.bid;fxSymbol=fx.symbol;
 }else if(x.profitCurrency!=='USD')return {ok:false,reason:'מטבע הרווח דורש תמיכת המרה נוספת'};
 const expected=x.contractSize*x.tickSize*rate;
 if(Math.abs(expected-x.tickValue)/expected>.02)return {ok:false,reason:'ערך הטיק אינו תואם למפרט ולהמרה'};
 const unit=x.contractSize*x.ask*rate;
 return {ok:true,unit,minimum:x.minLot*unit,minLot:x.minLot,step:x.lotStep,contractSize:x.contractSize,fxSymbol,rate};
}
const down=(n,step)=>Math.max(0,Number((Math.floor((n+1e-9)/step)*step).toFixed(8)));
function streak(scans,current,program,key){
 let n=1;for(let i=1;i<3;i++){const prev=scans.find(s=>Number(s.bar_time)===current.barTime-i*CONFIG.barSeconds)?.scan;if(!prev||prev.universe!==current.universe||prev.programs?.[program-1]?.key!==key)break;n++;}return n;
}
export function planCycle(snapshot,market,scans=[],closedLedger=[],now=Date.now()/1000,recentCommands=[]){
 // The SQL exchange independently verifies this acknowledgement before it can dispatch the next command.
 recentCommands=recentCommands.map(x=>snapshot.result?.status==='filled'&&snapshot.result.id===x.id?{...x,status:'filled'}:x);
 const items=market?.items||{},analysis=analyzeMarket({...market,totalAvailable:market?.total_available},now*1000),allClosed=new Map(closedLedger.map(x=>[x.ticket,x]));
 for(const x of snapshot.closed)allClosed.set(x.ticket,x);
 const programs=CONFIG.magics.map((magic,i)=>{
  const orders=snapshot.orders.filter(o=>o.magic===magic),realized=[...allClosed.values()].filter(o=>o.magic===magic).reduce((s,o)=>s+o.profit+o.swap+o.commission,0),floating=orders.reduce((s,o)=>s+o.profit+o.swap+o.commission,0);
  const valued=orders.map(o=>{const spec=quoteSpec(items[o.symbol],items,now,{forEntry:false});return {order:o,spec,exposure:spec.ok?o.lots*spec.unit:null};});
  const exposure=valued.every(v=>v.exposure!==null)?valued.reduce((s,v)=>s+v.exposure,0):null;
  const capital=Math.max(0,Math.min(CONFIG.budget,CONFIG.budget+realized+floating));
  return {id:i+1,label:'תוכנית צמיחה '+(i+1),origin:i===0?'NVDA':'QQQ',budget:CONFIG.budget,target:Math.min(CONFIG.budget*CONFIG.target,capital*CONFIG.target),cap:capital,realized,floating,equity:CONFIG.budget+realized+floating,exposure,orders,valued,symbol:orders[0]?.symbol||null};
 });
 const blocked=[],eligible=analysis.candidates.filter(c=>{const s=quoteSpec(items[c.symbol],items,now);if(!s.ok||s.minimum>CONFIG.budget*CONFIG.target){blocked.push({symbol:c.symbol,reason:s.ok?'כמות מזערית מעל יעד 4,000 דולר':s.reason,minimum:s.minimum||null});return false;}return true;});
 const universe='M5:'+fingerprint(eligible.map(x=>x.symbol)),scan={barTime:analysis.barTime,universe,programs:[]},commands=[];
 const fx=['USDILS#','USDILS'].map(s=>items[s]).find(v=>v&&recent(v.tickTime,now,60)&&recent(v.capturedAt,now,180)&&v.bid>0&&v.ask>=v.bid);
 const minTurnover=fx?100/fx.bid:null;
 let commonReason='';
 if(snapshot.historyOverflow)commonReason='היסטוריית עסקאות גדולה ממגבלת הסנכרון';
 else if(programs.some(p=>p.exposure===null||new Set(p.orders.map(o=>o.symbol)).size>1))commonReason='נדרש בירור פוזיציות או מחירים';
 const totalExposure=programs.every(p=>p.exposure!==null)?programs.reduce((s,p)=>s+p.exposure,0):null;
 const reservedCandidates=new Set();
 for(const p of programs){
  let action='HOLD',symbol=p.symbol,reason=commonReason,key='HOLD',candidate=null,command=null;
  const other=programs.find(v=>v.id!==p.id);
  const add=(verb,o,lots,purpose)=>({program:p.id,magic:CONFIG.magics[p.id-1],action:verb,symbol:o.symbol,lots,ticket:verb==='CLOSE'?o.ticket:0,purpose,destination:purpose==='rotation'?candidate?.symbol:null,barTime:analysis.barTime,decisionKey:[p.id,analysis.barTime,verb,o.symbol,verb==='CLOSE'?o.ticket:0].join(':'),spec:quoteSpec(items[o.symbol],items,now,{forEntry:verb==='BUY'}),cap:p.cap,target:p.target,reason});
  // Hard exposure protection does not wait three bars. Market gaps can still exceed a cap temporarily.
  if(!reason&&p.orders.length&&(p.exposure>p.cap+.01||p.cap<=0||totalExposure>CONFIG.capital+.01)){
   action='CLOSE';reason='צמצום חריגה מתקרת החשיפה';key='RISK';command=add('CLOSE',p.orders[0],p.orders[0].lots,'risk');
  }else if(!reason){
   if(!analysis.complete)reason='ממתין למחזור נתונים מלא';
   else if(!fx)reason='ממתין לשער USD/ILS לצורך סף הפעולה הקיים (100 ₪)';
   else {
    candidate=eligible.find(c=>c.symbol!==other.symbol&&!reservedCandidates.has(c.symbol)&&c.master>=60&&quoteSpec(items[c.symbol],items,now).minimum<=p.target);
    if(candidate)reservedCandidates.add(candidate.symbol);
    const current=analysis.candidates.find(c=>c.symbol===p.symbol);
    if(!p.orders.length){
     if(candidate){action='BUY';symbol=candidate.symbol;const rotation=recentCommands.find(x=>x.status==='filled'&&x.command.program===p.id&&x.command.purpose==='rotation'&&x.command.barTime===analysis.barTime&&x.command.destination===symbol);key=(rotation?'ROTATE:':'ENTRY:')+symbol;reason=rotation?'השלמת מעבר לאחר אישור המכירה בדמו':'כניסה לאחר שלושה אימותים';}
     else reason='אין נכס מתאים לציון ולתקציב';
    }else if(candidate&&candidate.symbol!==p.symbol&&current&&candidate.master-current.master>=10){
     action='CLOSE';key='ROTATE:'+candidate.symbol;reason='מעבר מועמד: שלושה אימותים ויתרון של 10 נקודות';
    }else if(current){
     if(p.exposure<p.target-CONFIG.budget*CONFIG.band){action='BUY';key='REBALANCE:BUY:'+symbol;reason='איזון צמיחה ל־80%';}
     else if(p.exposure>p.target+CONFIG.budget*CONFIG.band){action='CLOSE';key='REBALANCE:CLOSE:'+symbol;reason='איזון צמיחה ל־80%';}
     else reason='החשיפה בטווח האיזון';
    }else reason='אין נר סגור עדכני לנכס המוחזק';
   }
  }
  const confirmed=key==='RISK'?0:key==='HOLD'?0:streak(scans,scan,p.id,key);
  scan.programs.push({id:p.id,key,action,symbol,candidate:candidate?.symbol||null,score:candidate?.master??null,confirmed,reason});
  if(!command&&!commonReason&&confirmed>=3&&action!=='HOLD'){
   if(action==='BUY'){
    const s=quoteSpec(items[symbol],items,now),room=Math.max(0,p.target-(p.exposure||0)),lots=s.ok?down(room/(s.unit*1.005),s.step):0;
    if(!s.ok||lots<s.minLot||lots*s.unit<minTurnover)reason='אין כמות תקינה במסגרת התקציב וסף הפעולה';
    else if(snapshot.foreignOrders>0)reason='קיימות בחשבון הוראות שאינן של שתי התוכניות';
    else if(symbol===other.symbol)reason='הנכס מוחזק בתוכנית האחרת';
    else command=add('BUY',{symbol},lots,'entry-or-rebalance');
   }else {
    const o=p.orders[0],s=quoteSpec(items[o.symbol],items,now,{forEntry:false});let lots=o.lots;
    if(!key.startsWith('ROTATE:')){
     lots=down((p.exposure-p.target)/s.unit,s.step);if(o.lots-lots<s.minLot)lots=o.lots;
     lots=Math.min(o.lots,lots);
    }
    if(!s.ok||lots<s.minLot||lots*s.unit<minTurnover)reason='שינוי קטן מסף הפעולה או מכמות המסחר';
    else command=add('CLOSE',o,lots,key.startsWith('ROTATE:')?'rotation':'rebalance');
   }
  }
  p.status=reason;p.confirmations=confirmed;p.candidate=candidate?.symbol||null;
  if(command)commands.push(command);
 }
 // One broker operation at a time, reductions first. Additional orders require a new broker snapshot.
 commands.sort((a,b)=>(a.action==='CLOSE'?0:1)-(b.action==='CLOSE'?0:1)||a.program-b.program);
 return {programs:programs.map(({valued,...p})=>p),scan,command:commands[0]||null,eligibleCount:eligible.length,blocked,totalExposure,complete:analysis.complete,minTurnover,account:snapshot.account,mode:'demo',policy:{budgetPerProgram:CONFIG.budget,totalCap:CONFIG.capital,targetPerProgram:CONFIG.budget*CONFIG.target,plans:['growth','growth'],longOnly:true,confirmations:3,rotationAdvantage:10,minimumTurnoverILS:100},note:'עלויות ועסקאות מוצגות לפי דיווחי הדמו. אין התחייבות שמילוי דמו זהה למסחר אמיתי.'};
}
