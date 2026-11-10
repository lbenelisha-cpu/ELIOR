// Entry-only evidence. No orders, account state or exit-policy dependencies.
import {marketHours,stockSessionGap} from './colmex-market-hours.mjs';
export const DIRECTION_CONFIRMATION_POLICY='POC_EMA50_1H_RECLAIM_V1';
export const DIRECTION_REPORT='CHANNEL_POC_DIRECTION_CONDITIONS_V1';
const STEP=300000,HOUR=12*STEP,PERIOD=50;
const positive=n=>Number.isFinite(n)&&n>0;
export function hourlyTrend(bars,price,side,platform,now){
 const fail=reason=>({passed:false,reason,period:PERIOD,timeframe:'1h'});
 if(!['LONG','SHORT'].includes(side)||!['BINANCE','COLMEX'].includes(platform)||!positive(price)||!Number.isFinite(now)||!Array.isArray(bars))return fail('INVALID_HOURLY_TREND_DATA');
 const closed=bars.filter(b=>b.closed!==false&&b.closeTime<=now);
 if(closed.some((b,i)=>!positive(b.close)||!Number.isFinite(b.openTime)||b.openTime%STEP!==0||b.closeTime!==b.openTime+STEP||i&&b.openTime!==closed[i-1].closeTime&&!(platform==='COLMEX'&&stockSessionGap(closed[i-1].closeTime,b.closeTime))))return fail('INVALID_HOURLY_TREND_DATA');
 const groups=new Map();let session=null;
 for(const b of closed){
  let start=Math.floor(b.openTime/HOUR)*HOUR,end=start+HOUR;
  if(platform==='COLMEX'){
   if(!session||b.openTime<session.openAt||b.openTime>=session.closeAt){const hours=marketHours(b.openTime);if(!hours.open)return fail('INVALID_HOURLY_TREND_DATA');session=hours.session;}
   start=session.openAt+Math.floor((b.openTime-session.openAt)/HOUR)*HOUR;end=Math.min(start+HOUR,session.closeAt);
  }
  const g=groups.get(start)||{openTime:start,closeTime:end,rows:[]};g.rows.push(b);groups.set(start,g);
 }
 const hours=[...groups.values()].filter(g=>g.closeTime<=now&&g.rows.length===(g.closeTime-g.openTime)/STEP&&g.rows[0].openTime===g.openTime&&g.rows.at(-1).closeTime===g.closeTime).map(g=>({openTime:g.openTime,closeTime:g.closeTime,close:g.rows.at(-1).close}));
 if(hours.length<PERIOD+1)return {...fail('WAIT_HOURLY_TREND_HISTORY'),availableHours:hours.length,requiredHours:PERIOD+1};
 // Use a bounded, deterministic warm-up. The seed is the mean of 50 closes.
 const window=hours.slice(-100);let ema=window.slice(0,PERIOD).reduce((s,b)=>s+b.close,0)/PERIOD,previous=ema;
 for(const b of window.slice(PERIOD)){previous=ema;ema+=(b.close-ema)*2/(PERIOD+1);}
 const last=window.at(-1),direction=side==='LONG'?1:-1;
 const passed=direction*(ema-previous)>0&&direction*(last.close-ema)>0&&direction*(price-ema)>0;
 return {passed,reason:passed?'HOURLY_TREND_CONFIRMED':side==='LONG'?'HOURLY_LONG_TREND_BLOCK':'HOURLY_SHORT_TREND_BLOCK',period:PERIOD,timeframe:'1h',ema,previousEma:previous,lastClose:last.close,closedAt:last.closeTime,hours:window.length};
}
export function closedPocReclaim(model,bars,price,liveBar,now,after=0){
 const fail=reason=>({passed:false,reason});
 if(!model||!positive(model.profile?.poc)||!['LONG','SHORT'].includes(model.side))return fail('WAIT_POC_CLOSED_RECLAIM');
 const direction=model.side==='LONG'?1:-1,pc=model.profile.poc;
 // The return must occur after B and after the latest activation/close boundary.
 let touchedAt=null,confirmation=null;
 for(const b of bars){
  if(b.closed===false||b.closeTime>now||b.openTime<model.frozenAt||b.openTime<after)continue;
  if(touchedAt===null&&(direction===1?b.low<=pc:b.high>=pc))touchedAt=b.openTime;
  if(touchedAt!==null&&direction*(b.close-pc)>0){confirmation={touchAt:touchedAt,openTime:b.openTime,closeTime:b.closeTime,close:b.close};touchedAt=null;}
 }
 if(!confirmation||confirmation.closeTime!==liveBar?.openTime||now<confirmation.closeTime||now>=confirmation.closeTime+STEP)return fail('WAIT_POC_CLOSED_RECLAIM');
 if(direction*(price-pc)<=0)return fail('POC_RECLAIM_PRICE_INVALIDATED');
 if(direction===1?price>model.anchorB.price||liveBar.high>model.anchorB.price:price<model.anchorB.price||liveBar.low<model.anchorB.price)return fail('WAIT_POC_WAVE_CLOSE');
 return {passed:true,reason:'POC_CLOSED_RECLAIM_CONFIRMED',...confirmation,expiresAt:confirmation.closeTime+STEP};
}
export function directionConfirmation({model,bars,trendBars=bars,price,liveBar,now,after=0,platform,side}){
 const trend=hourlyTrend(trendBars,price,side,platform,now),reclaim=closedPocReclaim(model,bars,price,liveBar,now,after);
 return {policy:DIRECTION_CONFIRMATION_POLICY,trend,reclaim,passed:trend.passed&&reclaim.passed,reason:!trend.passed?trend.reason:reclaim.reason};
}
export function assertDirectionConfirmation(setup,price,now,liveBar){
 const c=setup?.directionConfirmation,m=setup?.pocModel,d=m?.side==='LONG'?1:-1;
 if(c?.policy!==DIRECTION_CONFIRMATION_POLICY||c.passed!==true||c.trend?.passed!==true||c.reclaim?.passed!==true||c.trend.period!==PERIOD||c.trend.timeframe!=='1h'||!Number.isFinite(c.trend.closedAt)||!Number.isFinite(c.reclaim.openTime)||c.reclaim.expiresAt!==c.reclaim.closeTime+STEP||!positive(c.trend.ema)||!positive(c.trend.previousEma)||!positive(c.trend.lastClose)||!positive(c.reclaim.close)||!Number.isFinite(c.reclaim.touchAt)||c.reclaim.touchAt<m?.frozenAt||c.reclaim.openTime<c.reclaim.touchAt||c.reclaim.closeTime!==c.reclaim.openTime+STEP||c.reclaim.closeTime!==setup.signalTime||c.reclaim.expiresAt!==setup.signalExpiresAt||c.trend.closedAt>c.reclaim.closeTime||!(d*(c.trend.ema-c.trend.previousEma)>0&&d*(c.trend.lastClose-c.trend.ema)>0&&d*(c.reclaim.close-m.profile.poc)>0))throw Error('POC_DIRECTION_CONFIRMATION_CHANGED');
 if(liveBar?.openTime!==c.reclaim.closeTime||now<c.reclaim.closeTime||now>=c.reclaim.expiresAt||!(d*(price-m.profile.poc)>0&&d*(price-c.trend.ema)>0))throw Error('POC_RECLAIM_PRICE_INVALIDATED');
}
