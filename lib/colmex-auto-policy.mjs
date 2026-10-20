import {evaluateWyckoff} from './wyckoff-strategy.mjs';
import {stockSessionGap,regularSession,SIM_SYMBOLS} from './colmex-simulation.mjs';
export const AUTO_POLICY=Object.freeze({version:'COLMEX_LIVE_100X3_V2',notionalUsd:100,maxPositions:3,stopLossPct:10,profitRetentionPct:80,minProfitHoldDays:7,pollSeconds:60,symbols:SIM_SYMBOLS});
export const LIVE_ACK='I_ACCEPT_LIVE_100_USD_3_POSITIONS_V2';
// Native Netlify runtime context is authoritative. Never trust a header or preview env override.
export function runtimeEnvironment(env,context){return {...env,CONTEXT:context?.deploy?.context??''};}
export function configuredLive(env){return env.CONTEXT==='production'&&env.COLMEX_AUTO_LIVE_ENABLED==='true'&&env.COLMEX_AUTO_LIVE_ACK===LIVE_ACK&&/^\d+$/.test(env.COLMEX_AUTO_ACCOUNT_ID||'');}
export function num(v){if(v===null||v===undefined||typeof v==='boolean'||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
export function ticks(price,sizes,up=false){
 const bands=(sizes||[]).filter(x=>Number(x.leftRangeLimit)<=price&&Number(x.tickSize)>0).sort((a,b)=>Number(b.leftRangeLimit)-Number(a.leftRangeLimit));const tick=Number(bands[0]?.tickSize);if(!tick)return null;
 // Recheck after rounding in case a price crosses a tier boundary.
 let result=Number(((up?Math.ceil:Math.floor)(price/tick- (up?1e-10:-1e-10))*tick).toFixed(10));
 const next=(sizes||[]).filter(x=>Number(x.leftRangeLimit)<=result&&Number(x.tickSize)>0).sort((a,b)=>Number(b.leftRangeLimit)-Number(a.leftRangeLimit))[0];
 if(next&&Number(next.tickSize)!==tick)result=Number((((up?Math.ceil:Math.floor)(result/Number(next.tickSize)))*Number(next.tickSize)).toFixed(10));return result;
}
export function planBuy({instrument,details,quote,positions,orders,cash,now,receivedAt}){
 if(!regularSession(now))return {reason:'OUTSIDE_REGULAR_SESSION'};
 if(!['EQUITY','ETF'].includes(instrument?.type)||details?.quotingCurrency!=='USD'||details?.symbolStatus!=='FULLY_OPEN')return {reason:'UNSUPPORTED_INSTRUMENT'};
 const ask=num(quote?.ap),bid=num(quote?.bp);if(!(ask>0&&bid>0&&bid<=ask)||now-receivedAt>10000||receivedAt>now)return {reason:'WAIT_BROKER_QUOTE'};
 if(positions.length+orders.filter(o=>String(o.side).toLowerCase()==='buy').length>=3)return {reason:'NO_FREE_SLOT'};
 if(positions.some(p=>String(p.tradableInstrumentId)===String(instrument.tradableInstrumentId))||orders.some(o=>String(o.tradableInstrumentId)===String(instrument.tradableInstrumentId)))return {reason:'EXISTING_POSITION_OR_ORDER'};
 const price=ticks(ask*1.001,details.tickSize,true),step=num(details.lotStep)*num(details.lotSize),min=num(details.minLot)*num(details.lotSize),max=num(details.maxLot)*num(details.lotSize);
 if(!(price>0&&step>0&&min>0&&max>=min))return {reason:'UNKNOWN_QUANTITY_RULES'};
 let qty=Number((Math.floor(100/price/step)*step).toFixed(10));qty=Math.min(qty,max);qty=Number((Math.floor(qty/step+1e-10)*step).toFixed(10));
 if(qty<min||qty<=0||qty*price>100+1e-8)return {reason:'MINIMUM_QUANTITY_ABOVE_100_USD'};
 // $100 is share notional before broker fees. Reserve $5 cash headroom; never use margin buying power.
 if(!(num(cash)>=qty*price+5))return {reason:'INSUFFICIENT_UNLEVERAGED_CASH'};
 const stopLoss=ticks(price*.9,details.tickSize,true);if(!(stopLoss>0&&stopLoss<bid))return {reason:'INVALID_STOP'};
 return {reason:'READY',order:{tradableInstrumentId:instrument.tradableInstrumentId,side:'buy',type:'limit',validity:'IOC',qty,price,stopLoss,stopLossType:'absolute',overnightExecution:false},notionalUsd:qty*price};
}
export function brokerBars(data,now){
 if(!Array.isArray(data?.barDetails))throw Error('HISTORY_SCHEMA');
 const bars=data.barDetails.filter(b=>Number(b.t)%300000===0&&Number(b.t)<=Math.floor(now/300000)*300000).map(b=>({openTime:Number(b.t)-300000,closeTime:Number(b.t),open:Number(b.o),high:Number(b.h),low:Number(b.l),close:Number(b.c),volume:Number(b.v),timeframe:'5m',closed:true})).filter(b=>regularSession(b.openTime)).sort((a,b)=>a.closeTime-b.closeTime);
 if(bars.some(b=>!Number.isFinite(b.closeTime)||!['open','high','low','close'].every(k=>Number.isFinite(b[k])&&b[k]>0)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close))||new Set(bars.map(b=>b.closeTime)).size!==bars.length)throw Error('HISTORY_SCHEMA');return bars;
}
export function entrySignal(bars,now,after,used=[]){
 if(!bars.length||now-bars.at(-1).closeTime>300000)return {ready:false,reason:'WAIT_CURRENT_5M_BARS'};
 let s=evaluateWyckoff(bars,{now,timeframe:'5m',isSessionGap:stockSessionGap});
 if(s.phase==='SPRING')s={...s,buyConfirmed:true,patternId:'5m:'+s.initialPeak.time+':'+s.springLow.time,signalTime:s.springLow.time,targetPrice:s.initialPeak.price*1.07};
 if(!s.buyConfirmed)return {ready:false,reason:s.phase};
 if(!(s.signalTime>after)||used.includes(s.patternId)||s.signalInvalidated||now-s.signalTime>=20*60000)return {ready:false,reason:'WAIT_NEW_WYCKOFF_SIGNAL'};
 return {ready:true,setup:s};
}
