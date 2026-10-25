import {evaluateWyckoff} from './wyckoff-strategy.mjs';
export const LIVE_SPRING_RSI_MODE='spring_rsi_live';
export function rsiSeries(closes,period=14){
 const out=closes.map(()=>null);if(closes.length<=period)return out;
 let gain=0,loss=0;
 for(let i=1;i<closes.length;i++){
  if(!Number.isFinite(closes[i])||!Number.isFinite(closes[i-1]))throw Error('INVALID_RSI_PRICE');
  const delta=closes[i]-closes[i-1],g=Math.max(0,delta),l=Math.max(0,-delta);
  if(i<=period){gain+=g/period;loss+=l/period;}else{gain=(gain*(period-1)+g)/period;loss=(loss*(period-1)+l)/period;}
  if(i>=period)out[i]=loss===0?(gain===0?50:100):100-100/(1+gain/loss);
 }
 return out;
}
export function observeLiveCandle(previous,price,time){
 if(!(Number.isFinite(price)&&price>0&&Number.isFinite(time)))return previous;
 if(previous&&time<previous.observedAt)return previous;
 const openTime=Math.floor(time/300000)*300000;
 return previous?.openTime===openTime?{...previous,high:Math.max(previous.high,price),low:Math.min(previous.low,price),close:price,observedAt:time}:
 {openTime,open:price,high:price,low:price,close:price,observedAt:time,closed:false};
}
export function liveSpringRsi(bars,{price,priceAsOf,now=Date.now(),liveBar=null,isSessionGap=null,used=[],rollingSearch=true,after=0,resetHighRsi=false}={}){
 const s=evaluateWyckoff(bars,{now,timeframe:'5m',isSessionGap,rollingSearch,after});
 const at=typeof priceAsOf==='number'?priceAsOf:Date.parse(priceAsOf);
 const reject=reason=>({...s,buyConfirmed:false,entryReason:reason});
 if(!(Number.isFinite(price)&&price>0&&Number.isFinite(at)&&at<=now&&now-at<=15000))return reject('WAIT_FRESH_PRICE');
 const bucket=Math.floor(at/300000)*300000,last=Number(bars.at(-1)?.closeTime);
 if(!((last<=bucket&&bucket-last<=1)||(typeof isSessionGap==='function'&&last<bucket&&isSessionGap(last,bucket))))return reject('WAIT_CURRENT_5M_BARS');
 if(liveBar&&liveBar.openTime!==bucket)return reject('WAIT_CURRENT_5M_BARS');
 const high=Math.max(price,liveBar?.high??price),low=Math.min(price,liveBar?.low??price);
 if(!Number.isFinite(high)||!Number.isFinite(low)||low<=0)return reject('INVALID_LIVE_BAR');
 let spring=s.springLow;
 if(s.phase==='CONSOLIDATION'&&s.consolidationBars>=3&&low<s.firstLow.price)
  spring={price:low,time:Math.max(bucket+1,at),index:bars.length,live:true};
 else if(s.phase!=='SPRING')return reject(s.phase);
 else if(low<spring.price)spring={price:low,time:Math.max(bucket+1,at),index:bars.length,live:true};
 if(high>=s.initialPeak.price)return reject('WYCKOFF_SIGNAL_INVALIDATED');
 const closes=bars.map(b=>Number(b.close)),entryRsi=rsiSeries([...closes,price]).at(-1);
 if(resetHighRsi&&entryRsi>30)return {phase:'SEARCH_PEAK',buyConfirmed:false,sellConfirmed:false,timeframe:'5m',entryRsi,searchAfter:now,entryReason:'SPRING_REJECTED_RSI_HIGH'};
 const patternId='5m:'+s.initialPeak.time+':SPRING_RSI:'+s.secondaryTest.time;
 const usedPattern=used.some(id=>id===patternId||String(id).startsWith('5m:'+s.initialPeak.time+':'));
 const ready=entryRsi!==null&&entryRsi>=0&&entryRsi<=30&&!usedPattern;
 return {...s,phase:'SPRING',springLow:spring,entryRsi,rsiCloses:closes,rsiBucket:bucket,
  patternId,signalTime:s.springLow?.time??spring.time,targetPrice:s.initialPeak.price*1.07,
  confirmation:{price,time:at,index:bars.length,live:true},buyConfirmed:ready,
  entryReason:usedPattern?'PATTERN_ALREADY_USED':entryRsi===null?'WAIT_RSI_DATA':ready?'WYCKOFF_SPRING_RSI_LIVE':'WAIT_RSI_0_30'};
}
export function assertLiveSpringRsi(trade,price,now=Date.now()){
 if(!(Number.isFinite(price)&&price>0)||Math.floor(now/300000)*300000!==trade.rsiBucket)throw Error('WAIT_CURRENT_5M_BARS');
 const value=rsiSeries([...(trade.rsiCloses||[]),price]).at(-1);
 if(value==null||value<0||value>30)throw Error('WAIT_RSI_0_30');
 if(!(price<trade.targetPrice))throw Error('WYCKOFF_SIGNAL_INVALIDATED');
}
