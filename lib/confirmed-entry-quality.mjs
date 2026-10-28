import {evaluateWyckoff} from './wyckoff-strategy.mjs';
import {rsiSeries} from './wyckoff-spring-rsi.mjs';
import {earlyWaveEntry} from './early-wave-entry.mjs';
import {stockSessionGap} from './colmex-market-hours.mjs';
export const CONFIRMED_QUALITY_POLICY=Object.freeze({version:'CONFIRMED_QUALITY_V1',timeframe:'5m',maPeriods:[100,200],slopeBars:4,volumeBars:20,minVolumeRatio:1,atrPeriod:14,atrMultiple:1.5,maxStopPct:3,maxRiskUsd:8,confirmationMaxAgeMs:900000});
export const BINANCE_STOP_POLICY='SETTINGS_ONLY_V1';
export const entryQualityPolicy=platform=>({...CONFIRMED_QUALITY_POLICY,version:platform+'_'+CONFIRMED_QUALITY_POLICY.version,
 ...(platform==='BINANCE'?{stopLossPolicy:BINANCE_STOP_POLICY,atrMultiple:null,maxStopPct:null}: {})});
export const COLMEX_QUALITY_POLICY=entryQualityPolicy('COLMEX');
export const BINANCE_CONFIRMED_POLICY=entryQualityPolicy('BINANCE');
const positive=n=>Number.isFinite(n)&&n>0;
const avg=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
export function qualityMeasures(bars,confirmationIndex,price){
 const p=CONFIRMED_QUALITY_POLICY,closes=bars.map(b=>b.close),n=bars.length,trend={ready:n>=204,blocked:false,averages:[]};
 if(trend.ready){
  trend.averages=p.maPeriods.map(period=>{const value=avg(closes.slice(-period)),prior=avg(closes.slice(n-period-p.slopeBars,n-p.slopeBars));return {period,value,changePct:(value/prior-1)*100};});
  trend.ready=trend.averages.every(m=>positive(m.value)&&Number.isFinite(m.changePct));
  trend.blocked=trend.ready&&trend.averages.every(m=>price<m.value&&m.changePct<0);
 }
 const previous=bars.slice(Math.max(0,confirmationIndex-p.volumeBars),confirmationIndex).map(b=>b.volume),v=bars[confirmationIndex]?.volume;
 const volumeReady=previous.length===p.volumeBars&&previous.every(n=>Number.isFinite(n)&&n>=0)&&positive(avg(previous))&&Number.isFinite(v)&&v>=0;
 const volume={ready:volumeReady,ratio:volumeReady?v/avg(previous):null,at:bars[confirmationIndex]?.closeTime??null};
 let atr=null;
 const ranges=bars.slice(1).map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-bars[i].close),Math.abs(b.low-bars[i].close)));
 if(ranges.length>=p.atrPeriod&&ranges.every(n=>Number.isFinite(n)&&n>=0)){
  atr=avg(ranges.slice(0,p.atrPeriod));for(const tr of ranges.slice(p.atrPeriod))atr=(atr*(p.atrPeriod-1)+tr)/p.atrPeriod;
 }
 return {trend,volume,atr:positive(atr)?atr:null,dataAt:bars.at(-1)?.closeTime??null};
}
function confirmedWave(bars,{now,after,used}){
 // Confirm a breakout on an actual closed bar; then recheck its price boundary live.
 for(let i=bars.length-1;i>=6&&bars[i].closeTime>=now-CONFIRMED_QUALITY_POLICY.confirmationMaxAgeMs;i--){
  const bar=bars[i],at=bar.closeTime-1;
  const wave=earlyWaveEntry(bars.slice(0,i),{now:at,price:bar.close,priceAsOf:at,after,used,liveBar:{openTime:bar.openTime,low:bar.low}});
  if(wave.buyConfirmed&&bar.closeTime>after&&bars.slice(i+1).every(b=>b.low>=wave.waveLow.price))return {...wave,entryMode:'early_wave_confirmed',confirmation:{price:bar.close,time:bar.closeTime,index:i},signalTime:bar.closeTime,signalExpiresAt:bar.closeTime+CONFIRMED_QUALITY_POLICY.confirmationMaxAgeMs};
 }
 return null;
}
export function assertQualityEntry(setup,price,now,liveBar=null){
 if(!positive(price)||now>=setup.signalExpiresAt||now<setup.signalTime)throw Error('WAIT_CLOSED_CONFIRMATION');
 const low=setup.springLow?.price??setup.waveLow?.price;
 if(liveBar&&(liveBar.openTime!==Math.floor(now/300000)*300000||!positive(liveBar.low)||liveBar.low<low))throw Error('QUALITY_SIGNAL_INVALIDATED');
 if(setup.entryMode==='spring_reclaim_confirmed'){
  if(!(price>setup.firstLow.price&&price<setup.initialPeak.price)||liveBar&&liveBar.high>=setup.initialPeak.price)throw Error('QUALITY_SIGNAL_INVALIDATED');
  const rsi=rsiSeries([...setup.rsiCloses,price]).at(-1);if(rsi===null||rsi>40)throw Error('WAIT_RSI_0_40');
 }else if(setup.entryMode==='early_wave_confirmed'){
  if(!(price>=setup.minimumPrice&&price>setup.breakoutPrice))throw Error('QUALITY_SIGNAL_INVALIDATED');
 }else throw Error('QUALITY_SIGNAL_INVALIDATED');
}
export function qualityEntry(bars,now,after,used,live,baseline,{platform='COLMEX',isSessionGap=stockSessionGap}={}){
 const policy=entryQualityPolicy(platform);
 bars=bars.map(b=>({...b,closeTime:b.closeTime%300000===299999?b.closeTime+1:b.closeTime}));
 if(bars.some(b=>b.closed===false||b.closeTime>now)||now-bars.at(-1).closeTime>300000)return {ready:false,reason:'WAIT_CURRENT_5M_BARS'};
 const s=evaluateWyckoff(bars,{now,timeframe:'5m',rollingSearch:true,after:live.searchAfter||0,isSessionGap});
 const at=typeof live.priceAsOf==='number'?live.priceAsOf:Date.parse(live.priceAsOf);
 const fresh=positive(live.price)&&Number.isFinite(at)&&at<=now&&now-at<=15000;
 const prefix=s.initialPeak?'5m:'+s.initialPeak.time+':':null;
 let candidate=null;
 if(s.buyConfirmed&&s.confirmation?.time>after&&!used.some(id=>prefix&&String(id).startsWith(prefix))){
  candidate={...s,entryMode:'spring_reclaim_confirmed',patternId:prefix+'RECLAIM:'+s.secondaryTest.time,signalTime:s.confirmation.time,signalExpiresAt:s.confirmation.time+CONFIRMED_QUALITY_POLICY.confirmationMaxAgeMs,rsiCloses:bars.map(b=>b.close)};
 }
 candidate??=confirmedWave(bars,{now,after,used});
 let confirmed=!!candidate&&fresh,reason=candidate?'WAIT_FRESH_PRICE':s.phase==='SPRING'||baseline.ready?'WAIT_CLOSED_CONFIRMATION':baseline.reason||s.phase;
 if(confirmed){try{assertQualityEntry(candidate,live.price,now,live.liveBar);}catch(e){confirmed=false;reason=e.message;}}
 const measures=qualityMeasures(bars,candidate?.confirmation.index??bars.length-1,live.price);
 const trend=measures.trend.ready&&!measures.trend.blocked,volume=measures.volume.ready&&measures.volume.ratio>=CONFIRMED_QUALITY_POLICY.minVolumeRatio;
 const variants={legacy:baseline.ready,confirmed,confirmed_trend:confirmed&&trend,confirmed_volume:confirmed&&volume,full_quality:confirmed&&trend&&volume};
 if(confirmed)reason=!measures.trend.ready?'WAIT_MA_HISTORY':!trend?'MA_DOWNTREND_BLOCK':!measures.volume.ready?'WAIT_VOLUME_HISTORY':!volume?'CONFIRMATION_VOLUME_LOW':!measures.atr?'WAIT_ATR_HISTORY':'READY';
 const ready=confirmed&&trend&&volume&&positive(measures.atr);
 const riskInput=ready?{version:policy.version,atr:measures.atr,structureLow:candidate.springLow?.price??candidate.waveLow.price}:null;
 const quality={version:policy.version,...measures,confirmed,entryMode:candidate?.entryMode??null,confirmationAt:candidate?.confirmation.time??null};
 const comparison={variants,legacy:baseline.ready?{patternId:baseline.setup.patternId,entryMode:baseline.setup.entryMode||'spring_rsi_live'}:null,confirmed:candidate?{patternId:candidate.patternId,entryMode:candidate.entryMode}:null};
 return {ready,reason,phase:candidate?.phase||s.phase,entryRsi:fresh&&candidate?.entryMode==='spring_reclaim_confirmed'?rsiSeries([...candidate.rsiCloses,live.price]).at(-1):null,setup:ready?{...candidate,entryPolicyVersion:policy.version,quality}:undefined,riskInput,quality,comparison,searchDiagnostic:baseline.searchDiagnostic};
}
