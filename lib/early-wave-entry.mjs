const STEP=300000;
export const EARLY_WAVE_POLICY=Object.freeze({enabled:true,timeframe:'5m',lookbackBars:6,breakoutBars:3,minReboundPct:1,maxPriceAgeMs:15000,rsiFilter:false});
export function earlyWaveEntry(bars,{price,priceAsOf,now=Date.now(),liveBar=null,used=[],after=0}={}){
 const reject=entryReason=>({entryMode:'early_wave_live',phase:'EARLY_WAVE',buyConfirmed:false,entryReason});
 const at=typeof priceAsOf==='number'?priceAsOf:Date.parse(priceAsOf),bucket=Math.floor(now/STEP)*STEP;
 if(!(Number.isFinite(price)&&price>0&&Number.isFinite(at)&&at<=now&&now-at<=EARLY_WAVE_POLICY.maxPriceAgeMs&&Math.floor(at/STEP)*STEP===bucket))return reject('WAIT_FRESH_PRICE');
 if(!Array.isArray(bars)||bars.length<6)return reject('WAIT_EARLY_WAVE_HISTORY');
 const window=bars.slice(-6);
 if(window.some((b,i)=>b.closed===false||b.timeframe&&b.timeframe!=='5m'||!Number.isFinite(Number(b.closeTime))||Number(b.closeTime)>bucket||
   !['high','low','close'].every(k=>Number.isFinite(Number(b[k]))&&Number(b[k])>0)||Number(b.high)<Number(b.close)||Number(b.low)>Number(b.close)||
   b.open!=null&&!(Number(b.open)>=Number(b.low)&&Number(b.open)<=Number(b.high))||i>0&&Number(b.closeTime)-Number(window[i-1].closeTime)!==STEP)||
   bucket-Number(window.at(-1).closeTime)>1)return reject('WAIT_CURRENT_5M_BARS');
 // Use only completed bars. No future peak is consulted to identify a wave.
 const lowBar=window.reduce((best,b)=>Number(b.low)<=Number(best.low)?b:best),low=Number(lowBar.low),lowTime=Number(lowBar.closeTime);
 const breakoutPrice=Math.max(...window.slice(-3).map(b=>Number(b.high))),minimumPrice=low*(1+EARLY_WAVE_POLICY.minReboundPct/100);
 const lowOpenTime=Number(lowBar.openTime??(lowTime-(lowTime%STEP===0?STEP:STEP-1))),patternId='early-wave:'+lowTime;
 const setup={entryMode:'early_wave_live',phase:'EARLY_WAVE',timeframe:'5m',patternId,signalTime:at,time:Number(window.at(-1).closeTime),
  waveLow:{price:low,time:lowTime,openTime:lowOpenTime},breakoutPrice,minimumPrice,signalBucket:bucket,signalExpiresAt:bucket+STEP,
  targetPrice:price*1.5,confirmation:{price,time:at,live:true}};
 let reason='EARLY_WAVE_BREAKOUT';
 if(lowOpenTime<after)reason='WAIT_NEW_EARLY_WAVE';
 else if(used.includes(patternId))reason='PATTERN_ALREADY_USED';
 else if(liveBar&&(Number(liveBar.openTime)!==bucket||!Number.isFinite(Number(liveBar.low))||Number(liveBar.low)<low))reason='EARLY_WAVE_INVALIDATED';
 else if(price<minimumPrice)reason='WAIT_EARLY_WAVE_1_PERCENT';
 else if(price<=breakoutPrice)reason='WAIT_EARLY_WAVE_BREAKOUT';
 return {...setup,buyConfirmed:reason==='EARLY_WAVE_BREAKOUT',entryReason:reason};
}
export function assertEarlyWaveEntry(trade,price,now=Date.now(),liveBar=null){
 const s=trade.setup||trade;
 if(Math.floor(now/STEP)*STEP!==s.signalBucket||now>=s.signalExpiresAt)throw Error('WAIT_CURRENT_5M_BARS');
 if(!(Number.isFinite(price)&&price>=s.minimumPrice&&price>s.breakoutPrice))throw Error('EARLY_WAVE_INVALIDATED');
 if(liveBar&&(Number(liveBar.openTime)!==s.signalBucket||!Number.isFinite(Number(liveBar.low))||Number(liveBar.low)<s.waveLow?.price))throw Error('EARLY_WAVE_INVALIDATED');
}
