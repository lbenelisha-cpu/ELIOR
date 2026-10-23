import {liveSpringRsi} from './wyckoff-spring-rsi.mjs';
import {evaluateWyckoff} from './wyckoff-strategy.mjs';
import {stockSessionGap,regularSession,SIM_SYMBOLS} from './colmex-simulation.mjs';
export const AUTO_POLICY=Object.freeze({version:'COLMEX_LIVE_TP4_SL1_V6',entryMode:'spring_rsi_live',entryRsi:{period:14,min:0,max:30,timeframe:'5m',includesOpenCandle:true},notionalUsd:800,maxPositions:3,stopLossPct:1,takeProfitPct:4,profitRetentionPct:null,minProfitHoldDays:0,pollSeconds:60,symbols:SIM_SYMBOLS});
// Existing deployment opt-in identifier stays stable; the authorized cap is AUTO_POLICY.notionalUsd.
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
export function planBuy({instrument,details,quote,positions,orders,cash,now,receivedAt,amountUsd=AUTO_POLICY.notionalUsd}){
 if(typeof amountUsd!=='number'||!Number.isFinite(amountUsd)||amountUsd<=0||amountUsd>AUTO_POLICY.notionalUsd)return {reason:'INVALID_BUY_AMOUNT'};
 if(!regularSession(now))return {reason:'OUTSIDE_REGULAR_SESSION'};
 if(!['EQUITY','ETF'].includes(instrument?.type)||details?.quotingCurrency!=='USD'||details?.symbolStatus!=='FULLY_OPEN')return {reason:'UNSUPPORTED_INSTRUMENT'};
 const ask=num(quote?.ap),bid=num(quote?.bp);if(!(ask>0&&bid>0&&bid<=ask)||now-receivedAt>10000||receivedAt>now)return {reason:'WAIT_BROKER_QUOTE'};
 if(positions.length+orders.filter(o=>String(o.side).toLowerCase()==='buy').length>=3)return {reason:'NO_FREE_SLOT'};
 if(positions.some(p=>String(p.tradableInstrumentId)===String(instrument.tradableInstrumentId))||orders.some(o=>String(o.tradableInstrumentId)===String(instrument.tradableInstrumentId)))return {reason:'EXISTING_POSITION_OR_ORDER'};
 const price=ticks(ask*1.001,details.tickSize,true),step=num(details.lotStep)*num(details.lotSize),min=num(details.minLot)*num(details.lotSize),max=num(details.maxLot)*num(details.lotSize);
 if(!(price>0&&step>0&&min>0&&max>=min))return {reason:'UNKNOWN_QUANTITY_RULES'};
 let qty=Number((Math.floor(amountUsd/price/step)*step).toFixed(10));qty=Math.min(qty,max);qty=Number((Math.floor(qty/step+1e-10)*step).toFixed(10));
 if(qty<min||qty<=0||qty*price>amountUsd+1e-8)return {reason:'MINIMUM_QUANTITY_ABOVE_BUDGET'};
 // The budget is share notional before broker fees. Reserve $5 cash headroom; never use margin buying power.
 if(!(num(cash)>=qty*price+5))return {reason:'INSUFFICIENT_UNLEVERAGED_CASH'};
 const stopLoss=ticks(price*.99,details.tickSize,true),takeProfit=ticks(price*1.04,details.tickSize,true);if(!(stopLoss>0&&stopLoss<bid&&takeProfit>price))return {reason:'INVALID_STOP'};
 // Native percentage brackets anchor to execution, not the IOC limit cap.
 // Existing positions are reconciled with absolute prices (the PATCH API contract).
 return {reason:'READY',order:{tradableInstrumentId:instrument.tradableInstrumentId,side:'buy',type:'limit',validity:'IOC',qty,price,stopLoss:1,stopLossType:'offset in %',takeProfit:4,takeProfitType:'offset in %',overnightExecution:false},notionalUsd:qty*price};
}
export function brokerBars(data,now){
 if(!Array.isArray(data?.barDetails))throw Error('HISTORY_SCHEMA');
 const bars=data.barDetails.filter(b=>Number(b.t)%300000===0&&Number(b.t)+300000<=now).map(b=>({openTime:Number(b.t),closeTime:Number(b.t)+300000,open:Number(b.o),high:Number(b.h),low:Number(b.l),close:Number(b.c),volume:Number(b.v),timeframe:'5m',closed:true})).filter(b=>regularSession(b.openTime)).sort((a,b)=>a.closeTime-b.closeTime);
 if(bars.some(b=>!Number.isFinite(b.closeTime)||!['open','high','low','close'].every(k=>Number.isFinite(b[k])&&b[k]>0)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close))||new Set(bars.map(b=>b.closeTime)).size!==bars.length)throw Error('HISTORY_SCHEMA');return bars;
}
// Do not join a Wyckoff pattern across a missing five-minute bar. A data gap
// starts a new search; ordinary exchange session gaps retain their prior rule.
export function contiguousHistory(bars){
 let start=0;
 for(let i=1;i<bars.length;i++)if(bars[i].closeTime-bars[i-1].closeTime!==300000&&!stockSessionGap(bars[i-1].closeTime,bars[i].closeTime))start=i;
 return {bars:bars.slice(start),discarded:start,resetAt:start?bars[start].closeTime:null};
}
export function entrySignal(bars,now,after,used=[],live={}){
 if(bars.length<3||now-bars.at(-1).closeTime>300000)return {ready:false,reason:'WAIT_CURRENT_5M_BARS'};
 const s=liveSpringRsi(bars,{...live,now,used,isSessionGap:stockSessionGap,rollingSearch:true,after:live.searchAfter||0});
 if(!s.buyConfirmed)return {ready:false,reason:s.entryReason,entryRsi:s.entryRsi,phase:s.phase};
 if(!(s.signalTime>after)||s.signalInvalidated)return {ready:false,reason:'WAIT_NEW_WYCKOFF_SIGNAL'};
 return {ready:true,setup:s,entryRsi:s.entryRsi};
}
