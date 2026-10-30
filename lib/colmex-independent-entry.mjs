import {comparisonBars,independentBreakout} from './entry-method-comparison.mjs';
import {qualityMeasures,COLMEX_QUALITY_POLICY} from './confirmed-entry-quality.mjs';
import {stockSessionGap} from './colmex-market-hours.mjs';
import {validateTradeSettings} from './trade-settings.mjs';
const STEP=300000,positive=n=>Number.isFinite(n)&&n>0;
export const COLMEX_BREAKOUT_POLICY=Object.freeze({version:'COLMEX_INDEPENDENT_BREAKOUT_V1',entryMode:'independent_breakout',timeframe:'5m',lookbackBars:20,minVolumeRatio:1.5,minMeanDollarVolume:10000,signalValidityMs:STEP,priority:'EXISTING_QUALITY_FIRST'});
export function colmexBreakoutConfig(env={}){
 const after=Date.parse(env.COLMEX_INDEPENDENT_BREAKOUT_AFTER||''),requested=env.COLMEX_INDEPENDENT_BREAKOUT_ENABLED==='true';
 return {...COLMEX_BREAKOUT_POLICY,enabled:requested&&positive(after),enabledAfter:positive(after)?after:null,error:requested&&!positive(after)?'ACTIVATION_TIME_REQUIRED':null};
}
export function assertColmexBreakout(setup,price,now,liveBar){
 if(setup?.entryMode!=='independent_breakout'||setup.entryPolicyVersion!==COLMEX_BREAKOUT_POLICY.version||!positive(setup.level)||!positive(setup.signalTime)||setup.signalTime%STEP!==0||setup.signalExpiresAt!==setup.signalTime+STEP||now<setup.signalTime||now>=setup.signalExpiresAt)throw Error('BREAKOUT_SIGNAL_EXPIRED');
 if(!positive(price)||price<=setup.level)throw Error('BREAKOUT_PRICE_INVALIDATED');
 if(!liveBar||liveBar.openTime!==Math.floor(now/STEP)*STEP||!positive(liveBar.low)||liveBar.low>price)throw Error('WAIT_BREAKOUT_LIVE_BAR');
 if(liveBar.low<=setup.level)throw Error('BREAKOUT_PRICE_INVALIDATED');
}
export function colmexBreakoutEntry({bars,price,priceAsOf,now,entryAfter=0,used=[],liveBar,settings={}},config={}){
 const reject=reason=>({ready:false,reason});
 if(!config.enabled||!positive(config.enabledAfter))return reject('INDEPENDENT_ENTRY_DISABLED');
 if(!positive(price)||!Number.isFinite(priceAsOf)||priceAsOf>now||now-priceAsOf>10000)return reject('WAIT_BROKER_QUOTE');
 let data;try{data=comparisonBars(bars,now,'COLMEX').slice(-205);}catch{return reject('INVALID_BREAKOUT_HISTORY');}
 if(data.length<204)return reject('WAIT_BREAKOUT_HISTORY');
 if(data.some((b,i)=>i&&b.closeTime-data[i-1].closeTime!==STEP&&!stockSessionGap(data[i-1].closeTime,b.closeTime)))return reject('GAPPED_BREAKOUT_HISTORY');
 const signal=independentBreakout(data,now,'COLMEX');if(!signal.ready)return reject(signal.reason);
 if(signal.at<=Math.max(config.enabledAfter,entryAfter))return reject('WAIT_NEW_BREAKOUT_SIGNAL');
 const patternId='colmex-independent-breakout:5m:'+signal.at;if(used.includes(patternId))return reject('BREAKOUT_PATTERN_ALREADY_USED');
 const exits=validateTradeSettings(settings),measures=qualityMeasures(data,data.length-1,price);
 if(!positive(measures.atr))return reject('WAIT_ATR_HISTORY');
 const setup={entryMode:'independent_breakout',entryPolicyVersion:COLMEX_BREAKOUT_POLICY.version,patternId,signalTime:signal.at,signalExpiresAt:signal.at+STEP,level:signal.level,volumeRatio:signal.volumeRatio,meanDollarVolume:signal.meanDollarVolume,targetPrice:price*(1+exits.takeProfitPct/100),confirmation:{time:signal.at,price:signal.price},phase:'INDEPENDENT_BREAKOUT',buyConfirmed:true};
 try{assertColmexBreakout(setup,price,now,liveBar);}catch(e){return reject(e.message);}
 return {ready:true,reason:'INDEPENDENT_BREAKOUT_READY',setup,phase:setup.phase,quality:{...measures,volumeRatio:signal.volumeRatio,meanDollarVolume:signal.meanDollarVolume},riskInput:{version:COLMEX_QUALITY_POLICY.version,atr:measures.atr,structureLow:Math.min(data.at(-1).low,signal.level)}};
}
