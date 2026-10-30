import {comparisonBars,independentBreakout,ENTRY_COMPARISON_POLICY} from './entry-method-comparison.mjs';
import {qualityMeasures,BINANCE_CONFIRMED_POLICY} from './confirmed-entry-quality.mjs';

const STEP=300000,positive=n=>Number.isFinite(n)&&n>0;
export const INDEPENDENT_ENTRY_POLICY=Object.freeze({version:'BINANCE_INDEPENDENT_BREAKOUT_V1',entryMode:'independent_breakout',timeframe:'5m',lookbackBars:20,minVolumeRatio:1.5,minMeanDollarVolume:10000,signalValidityMs:STEP,priority:'EXISTING_QUALITY_FIRST'});

// An explicit owner-installed flag and activation boundary are both required.
// Research results never change this permission or select a winning strategy.
export function independentEntryConfig(env={}){
 const requested=env.BINANCE_INDEPENDENT_BREAKOUT_ENABLED==='true';
 const after=Date.parse(env.BINANCE_INDEPENDENT_BREAKOUT_AFTER||'');
 return {...INDEPENDENT_ENTRY_POLICY,enabled:requested&&positive(after),enabledAfter:positive(after)?after:null,error:requested&&!positive(after)?'ACTIVATION_TIME_REQUIRED':null};
}

export function assertIndependentBreakoutEntry(setup,price,now,liveBar){
 if(setup?.entryMode!=='independent_breakout'||setup.policyVersion!==INDEPENDENT_ENTRY_POLICY.version||
   !positive(setup.level)||!positive(setup.signalTime)||setup.signalTime%STEP!==0||
   setup.signalExpiresAt!==setup.signalTime+STEP||now<setup.signalTime||now>=setup.signalExpiresAt)throw Error('BREAKOUT_SIGNAL_EXPIRED');
 if(!positive(price)||price<=setup.level)throw Error('BREAKOUT_PRICE_INVALIDATED');
 if(!liveBar||liveBar.openTime!==Math.floor(now/STEP)*STEP||!positive(liveBar.low)||liveBar.low>price)throw Error('WAIT_BREAKOUT_LIVE_BAR');
 if(liveBar.low<=setup.level)throw Error('BREAKOUT_PRICE_INVALIDATED');
}

export function independentBreakoutEntry({bars,price,priceAsOf,now=Date.now(),usedPatternIds=[],entryAfter=0,liveBar},config={}){
 const reject=reason=>({ready:false,reason});
 if(config.enabled!==true||!positive(config.enabledAfter))return reject('INDEPENDENT_ENTRY_DISABLED');
 const quoteAt=typeof priceAsOf==='number'?priceAsOf:Date.parse(priceAsOf);
 if(!positive(price)||!Number.isFinite(quoteAt)||quoteAt>now||now-quoteAt>15000)return reject('WAIT_FRESH_PRICE');
 let data;
 try{data=comparisonBars(bars,now,'BINANCE').slice(-205);}catch{return reject('INVALID_BREAKOUT_HISTORY');}
 if(data.length<204)return reject('WAIT_BREAKOUT_HISTORY');
 if(data.some((b,i)=>i&&b.closeTime-data[i-1].closeTime!==STEP))return reject('GAPPED_BREAKOUT_HISTORY');
 const signal=independentBreakout(data,now,'BINANCE');
 if(!signal.ready)return reject(signal.reason);
 const patternId='independent-breakout:5m:'+signal.at;
 if(signal.at<=Math.max(config.enabledAfter,entryAfter))return reject('WAIT_NEW_BREAKOUT_SIGNAL');
 if(usedPatternIds.includes(patternId))return reject('BREAKOUT_PATTERN_ALREADY_USED');
 const setup={entryMode:'independent_breakout',policyVersion:INDEPENDENT_ENTRY_POLICY.version,patternId,
   signalTime:signal.at,signalExpiresAt:signal.at+STEP,level:signal.level,volumeRatio:signal.volumeRatio,
   meanDollarVolume:signal.meanDollarVolume,confirmation:{time:signal.at,price:signal.price},phase:'INDEPENDENT_BREAKOUT',buyConfirmed:true};
 try{assertIndependentBreakoutEntry(setup,price,now,liveBar);}catch(error){return reject(error.message);}
 const measures=qualityMeasures(data,data.length-1,price);
 if(!measures.trend.ready||measures.trend.blocked)return reject('MA_DOWNTREND_BLOCK');
 if(!positive(measures.atr))return reject('WAIT_ATR_HISTORY');
 // Keep the existing Binance settings-only stop and risk budget calculation.
 return {ready:true,reason:'INDEPENDENT_BREAKOUT_READY',setup,phase:setup.phase,
   quality:{version:INDEPENDENT_ENTRY_POLICY.version,...measures,volumeRatio:signal.volumeRatio,meanDollarVolume:signal.meanDollarVolume},
   riskInput:{version:BINANCE_CONFIRMED_POLICY.version,atr:measures.atr,structureLow:Math.min(data.at(-1).low,signal.level)}};
}

export function assertIndependentBreakoutSubmission(input,config,trade){
 const check=independentBreakoutEntry(input,config);
 if(!check.ready)throw Error(check.reason);
 if(check.setup.patternId!==trade?.patternId||check.setup.signalTime!==trade.setup?.signalTime||check.setup.level!==trade.setup?.level)throw Error('BREAKOUT_SIGNAL_CHANGED');
 return check;
}

// Catch accidental drift from the registered, separately reported study.
if(['lookbackBars','minVolumeRatio','minMeanDollarVolume'].some(k=>INDEPENDENT_ENTRY_POLICY[k]!==ENTRY_COMPARISON_POLICY[k]))throw Error('BREAKOUT_POLICY_MISMATCH');
