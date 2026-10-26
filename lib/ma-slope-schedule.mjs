import {analyzeSlope} from './ma-slope.mjs?v=20261026-ma100';

// Shared display and observation policy; never an order gate. The existing offline MA20 research keeps its original defaults.
export const SLOPE_SCHEDULE_POLICY=Object.freeze({fastPeriod:100,slowPeriod:200,intervalMs:300000,checkMinutes:10,allowedCheckMinutes:[10,20],lookbackBars:10});

export function analyzeScheduledSlope(bars,{checkMinutes=10,now=Date.now(),lookbackBars=10,isSessionGap=()=>false}={}){
 if(![10,20].includes(checkMinutes)||!Number.isFinite(now))return {status:'INVALID_DATA',automaticExitEnabled:false};
 const intervalMs=300000,checkMs=checkMinutes*60000,checkAt=Math.floor(now/checkMs)*checkMs,nextCheckAt=checkAt+checkMs;
 const options={intervalMs,lookbackBars,fastPeriod:100,comparisonBars:checkMs/intervalMs,isSessionGap};
 // Freshness is checked against the newest available candle, independently of
 // the intentionally held 10/20-minute measurement. An outage never freezes green.
 const latest=analyzeSlope(bars,{...options,now});
 const timing={checkMinutes,checkAt,nextCheckAt,latestDataAt:latest.asOf??null};
 if(latest.status!=='READY')return {...latest,...timing};
 const sample=analyzeSlope(bars,{...options,now:checkAt});
 // Binance closes at boundary-1ms; Colmex uses the exact boundary. Require the
 // candle for this scheduled check and never advance the timestamp on a cache hit.
 const atBoundary=Number.isFinite(sample.asOf)&&Math.abs(sample.asOf-checkAt)<=1;
 if(!atBoundary&&['READY','STALE'].includes(sample.status))return {...sample,...timing,status:'WAIT_UPDATE'};
 return {...sample,...timing};
}
