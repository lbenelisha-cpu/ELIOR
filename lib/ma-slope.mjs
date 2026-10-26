// Analytical values only. This module never submits or authorizes an order.
export const SLOPE_POLICY=Object.freeze({version:'MA_SLOPE_ANALYSIS_V1',intervalMs:300000,slowPeriod:200,fastPeriod:20,lookbackBars:10,angleScalePctPerMinute:.01,confirmationBars:2,automaticExitEnabled:false});
export function slopeAngle(pctPerMinute,scale=SLOPE_POLICY.angleScalePctPerMinute){
 if(!Number.isFinite(pctPerMinute)||!Number.isFinite(scale)||scale<=0)return null;
 return Math.atan(pctPerMinute/scale)*180/Math.PI;
}
export function angleSlope(degrees,scale=SLOPE_POLICY.angleScalePctPerMinute){
 if(!Number.isFinite(degrees)||Math.abs(degrees)>=90||!Number.isFinite(scale)||scale<=0)return null;
 return Math.tan(degrees*Math.PI/180)*scale;
}
export function slopeHistory(input,{intervalMs=300000,lookbackBars=10,period=200,now=Date.now(),isSessionGap=()=>false}={}){
 if(!Array.isArray(input)||!Number.isFinite(now)||!Number.isFinite(intervalMs)||intervalMs<=0||![5,10].includes(lookbackBars)||!Number.isInteger(period)||period<2)throw Error('INVALID_SLOPE_INPUT');
 const bars=[];
 for(const b of input){
  const openTime=b.openTime==null?Date.parse(b.date):Number(b.openTime),closeTime=b.closeTime==null?openTime+intervalMs:Number(b.closeTime),close=Number(b.close);
  if(!Number.isFinite(openTime)||!Number.isFinite(closeTime)||![intervalMs,intervalMs-1].includes(closeTime-openTime)||!(Number.isFinite(close)&&close>0))throw Error('INVALID_SLOPE_BAR');
  if(b.closed===false||closeTime>now)continue;
  if(bars.length&&openTime<=bars.at(-1).openTime)throw Error('SLOPE_TIME_ORDER');
  bars.push({openTime,closeTime,close});
 }
 let sum=0,segmentStart=0;
 const history=[];
 for(let i=0;i<bars.length;i++){
  const b=bars[i],prev=bars[i-1];
  // MA may span verified exchange closures. The local slope must not bridge
  // a closure or missing bar: dividing an overnight gap into trading minutes
  // would create a misleading speed measurement.
  if(prev&&b.openTime-prev.openTime!==intervalMs&&!isSessionGap(prev.openTime+intervalMs,b.openTime+intervalMs)){segmentStart=i;sum=0;}
  sum+=b.close;if(i-segmentStart>=period)sum-=bars[i-period].close;
  const average=i-segmentStart+1>=period?sum/period:null,past=history[i-lookbackBars];
  const continuous=past&&b.openTime-past.openTime===lookbackBars*intervalMs;
  const minutes=continuous?(b.closeTime-past.closeTime)/60000:null;
  const slope=average!==null&&past?.average!==null&&past?.average>0&&continuous&&i-lookbackBars>=segmentStart?100*(average/past.average-1)/minutes:null;
  history.push({...b,average,pctPerMinute:slope,angle:slopeAngle(slope)});
 }
 return history;
}
export function analyzeSlope(bars,options={}){
 const lookbackBars=options.lookbackBars??SLOPE_POLICY.lookbackBars,intervalMs=options.intervalMs??SLOPE_POLICY.intervalMs,now=options.now??Date.now();
 try{
  const slow=slopeHistory(bars,{...options,period:200,lookbackBars,intervalMs,now}),fast=slopeHistory(bars,{...options,period:20,lookbackBars,intervalMs,now});
  const last=slow.at(-1),stale=!!last&&now-last.closeTime>intervalMs*2;
  const ready=Number.isFinite(last?.pctPerMinute)&&Number.isFinite(fast.at(-2)?.pctPerMinute);
  return {status:!last?'NO_DATA':!ready?(Number.isFinite(last.average)?'WAIT_WINDOW':'WARMUP'):stale?'STALE':'READY',lookbackBars,minutes:lookbackBars*intervalMs/60000,asOf:last?.closeTime??null,bars:slow.length,required:200+lookbackBars,slow:last??null,fast:fast.at(-1)??null,previousFast:fast.at(-2)??null,automaticExitEnabled:false};
 }catch(error){return {status:'INVALID_DATA',reason:error.message,lookbackBars,automaticExitEnabled:false};}
}
export function slopeReading(snapshot,side='LONG'){
 if(!['LONG','SHORT'].includes(side))throw Error('INVALID_SLOPE_SIDE');
 if(snapshot.status!=='READY')return 'UNAVAILABLE';
 const sign=side==='LONG'?1:-1,current=sign*snapshot.fast.pctPerMinute,previous=sign*snapshot.previousFast.pctPerMinute,epsilon=1e-10;
 if(Math.abs(current)<epsilon&&Math.abs(previous)<epsilon)return 'FLAT';
 if(current<=0&&previous<=0)return 'AGAINST_CONFIRMED';
 if(current<previous-epsilon)return 'WEAKENING';
 return current>0?'SUPPORTIVE':'AGAINST_PENDING';
}
// Candidate for offline research only. Require two separately closed readings,
// after entry, and contiguous time. No default angle is a live exit threshold.
export function slopeExitCandidate(history,index,{side='LONG',thresholdAngle=0,entryAt=-Infinity,intervalMs=300000}={}){
 if(!['LONG','SHORT'].includes(side)||!Number.isFinite(thresholdAngle)||Math.abs(thresholdAngle)>=90)return false;
 const sign=side==='LONG'?1:-1,threshold=angleSlope(thresholdAngle),a=history[index-1],b=history[index];
 return !!(a&&b&&Number.isFinite(a.pctPerMinute)&&Number.isFinite(b.pctPerMinute)&&a.closeTime>entryAt&&b.closeTime-a.closeTime===intervalMs&&sign*a.pctPerMinute<=threshold&&sign*b.pctPerMinute<=threshold);
}
