import {createHash} from 'node:crypto';
import {score} from './agent.mjs';
export const fingerprint=a=>createHash('sha256').update(JSON.stringify([...a].sort())).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const symbolOK=x=>typeof x==='string'&&x.length>0&&x.length<=64&&!/[\u0000-\u001f]/.test(x)&&!['__proto__','constructor','prototype'].includes(x);
export function validateMarket(d,now=Date.now()){
 if(d.tradeMode!==0||d.isDemo!==true)throw Error('Verified demo required');
 if(d.version!==1||d.account!=='102598'||d.server!=='TGLColmex-Demo')throw Error('Unexpected market account');
 if(!Number.isInteger(d.capturedAt)||Math.abs(now/1000-d.capturedAt)>120)throw Error('MT4 computer clock differs from UTC; check Windows time');
 if(!Array.isArray(d.catalog)||!d.catalog.length||d.catalog.length>600||!d.catalog.every(symbolOK)||new Set(d.catalog).size!==d.catalog.length)throw Error('Invalid symbol catalog');
 if(!Number.isInteger(d.totalAvailable)||d.totalAvailable<d.catalog.length)throw Error('Invalid catalog count');
 if(!Array.isArray(d.items)||!d.items.length||d.items.length>30||new Set(d.items.map(x=>x.symbol)).size!==d.items.length)throw Error('Invalid market batch');
 const items=d.items.map(x=>{
  if(!d.catalog.includes(x.symbol)||typeof x.description!=='string'||x.description.length>200||typeof x.tradeAllowed!=='boolean')throw Error('Invalid instrument');
  for(const k of ['bid','ask','tickTime','tickSize','tickValue','contractSize','minLot','lotStep','profitMode','marginRequired','swapLong','swapShort','swapType'])if(!finite(x[k]))throw Error('Invalid '+k);
  if(!/^[A-Z]{3}$/.test(x.depositCurrency)||![x.baseCurrency,x.profitCurrency].every(c=>typeof c==='string'&&c.length<=16))throw Error('Invalid contract currency');
  if(!Array.isArray(x.bars)||x.bars.length>60)throw Error('Invalid bar count');
  let previous=Infinity;
  const bars=x.bars.map(b=>{
   if(!Number.isInteger(b.time)||b.time<=0||b.time>=previous||b.time+1800>d.capturedAt+5||!finite(b.close)||b.close<=0)throw Error('Invalid or unfinished market bar');
   previous=b.time;return {time:b.time,close:b.close};
  });
  return {symbol:x.symbol,description:x.description,tradeAllowed:x.tradeAllowed,bid:x.bid,ask:x.ask,tickTime:x.tickTime,tickSize:x.tickSize,tickValue:x.tickValue,contractSize:x.contractSize,minLot:x.minLot,lotStep:x.lotStep,profitMode:x.profitMode,depositCurrency:x.depositCurrency,baseCurrency:x.baseCurrency,profitCurrency:x.profitCurrency,marginRequired:x.marginRequired,swapLong:x.swapLong,swapShort:x.swapShort,swapType:x.swapType,bars,capturedAt:d.capturedAt};
 });
 return {catalog:[...d.catalog].sort(),catalogId:fingerprint(d.catalog),totalAvailable:d.totalAvailable,capturedAt:d.capturedAt,items};
}
export function analyzeMarket(state,now=Date.now()){
 const catalog=state?.catalog||[],items=state?.items||{};
 const target=Math.floor(now/1800000)*1800-1800,blocked=[],candidates=[];
 let observed=0;
 for(const symbol of catalog){
  const x=items[symbol];
  let reason='';
  if(!x||now/1000-x.capturedAt>600||x.capturedAt>now/1000+5)reason='ממתין לעדכון במחזור האיסוף';
  else {
   observed++;
   if(!x.tradeAllowed)reason='הברוקר אינו מאפשר מסחר בנכס';
   else if(x.tickTime>now/1000+5||now/1000-x.tickTime>600)reason='אין מחיר שוק טרי — ייתכן שהשוק סגור';
   else if(x.bid<=0||x.ask<x.bid)reason='מחיר קנייה/מכירה חסר או שגוי';
   else if(x.tickSize<=0||x.tickValue<=0||x.contractSize<=0||x.minLot<=0||x.lotStep<=0)reason='מפרט חוזה חסר';
   else if(![0,1,2].includes(x.profitMode))reason='שיטת תמחור שאינה נתמכת';
   else {
    const i=x.bars.findIndex(b=>b.time===target);
    if(i<0||x.bars.length-i<25)reason='ממתין ל־25 נרות ולנר חצי־שעה סגור משותף';
    else {
     const q=score(x.bars.slice(i));
     candidates.push({symbol,description:x.description,...q,barTime:target,bid:x.bid,ask:x.ask,spreadPercent:100*(x.ask-x.bid)/x.bid,profitMode:x.profitMode,contractSize:x.contractSize,tickSize:x.tickSize,tickValue:x.tickValue,minLot:x.minLot,lotStep:x.lotStep});
    }
   }
  }
  if(reason)blocked.push({symbol,reason});
 }
 candidates.sort((a,b)=>b.master-a.master||a.symbol.localeCompare(b.symbol));
 return {source:'colmex-mt4',readOnly:true,account:'102598',server:'TGLColmex-Demo',catalogCount:catalog.length,totalAvailable:state?.totalAvailable||0,observed,candidates,blocked,barTime:target,complete:catalog.length>0&&observed===catalog.length,universeId:fingerprint(candidates.map(x=>x.symbol)),receivedAt:state?.received_at||null};
}
export function confirmation(scans){
 const first=scans[0];let consecutive=0;
 if(first)for(let i=0;i<Math.min(scans.length,3);i++){
  const s=scans[i];if(s.leader!==first.leader||s.score<60||s.universe_id!==first.universe_id||Number(first.bar_time)-Number(s.bar_time)!==i*1800)break;
  consecutive++;
 }
 return {symbol:first?.leader||null,consecutive,required:3,verified:consecutive===3};
}
