import {channelProtectionSnapshot,validateChannelProfitEntry} from './channel-profit-protection.mjs';
import '../regression-trend.js';
import '../parallel-channel.js';
import {comparisonBars} from './entry-method-comparison.mjs';
import {stockSessionGap} from './colmex-market-hours.mjs';
import {qualityMeasures,BINANCE_CONFIRMED_POLICY,COLMEX_QUALITY_POLICY} from './confirmed-entry-quality.mjs';
import {validateTradeSettings} from './trade-settings.mjs';
const STEP=300000,positive=n=>Number.isFinite(n)&&n>0;
export const CHANNEL_PRIMARY_POLICY=Object.freeze({version:'CHANNEL_PRIMARY_BREAKOUT_V1',entryMode:'channel_breakout',timeframe:'5m',period:100,minTouchesPerSide:2,minVolumeRatio:1.5,minMeanDollarVolume:10000,regressionRole:'RISING_AND_ABOVE_CENTER',priority:'CHANNEL_ONLY',signalValidityMs:STEP});
export function channelEntryConfig(env={},platform='BINANCE'){
 const requested=env[platform+'_CHANNEL_PRIMARY_ENABLED']==='true',after=Date.parse(env[platform+'_CHANNEL_PRIMARY_AFTER']||'');
 return {...CHANNEL_PRIMARY_POLICY,platform,requested,enabled:requested&&positive(after),enabledAfter:positive(after)?after:null,error:requested&&!positive(after)?'CHANNEL_ACTIVATION_TIME_REQUIRED':null};
}
export function assertChannelEntry(setup,price,now,liveBar){
 if(setup?.entryMode!=='channel_breakout'||setup.policyVersion!==CHANNEL_PRIMARY_POLICY.version||!positive(setup.signalTime)||setup.signalTime%STEP!==0||setup.signalExpiresAt!==setup.signalTime+STEP||now<setup.signalTime||now>=setup.signalExpiresAt)throw Error('CHANNEL_SIGNAL_EXPIRED');
 if(!positive(setup.level)||!positive(setup.liveLevel)||!positive(setup.regressionCenter)||!(setup.regressionSlope>0))throw Error('CHANNEL_MODEL_INVALID');
 const floor=Math.max(setup.level,setup.liveLevel,setup.regressionCenter);
 if(!positive(price)||price<=floor)throw Error('CHANNEL_PRICE_INVALIDATED');
 if(!liveBar||liveBar.openTime!==Math.floor(now/STEP)*STEP||!positive(liveBar.low)||liveBar.low>price)throw Error('WAIT_CHANNEL_LIVE_BAR');
 if(liveBar.low<=floor)throw Error('CHANNEL_PRICE_INVALIDATED');
}
export function channelEntry({bars,price,priceAsOf,now=Date.now(),entryAfter=0,usedPatternIds=[],used=usedPatternIds,liveBar,settings={}},config={}){
 const reject=reason=>({ready:false,reason,phase:'CHANNEL_PRIMARY'});
 if(!config.enabled)return reject(config.error||'CHANNEL_PRIMARY_DISABLED');
 const quoteAt=typeof priceAsOf==='number'?priceAsOf:Date.parse(priceAsOf),platform=config.platform;
 if(!positive(price)||!Number.isFinite(quoteAt)||quoteAt>now||now-quoteAt>(platform==='COLMEX'?10000:15000))return reject('WAIT_FRESH_PRICE');
 let data;try{data=comparisonBars(bars,now,platform).slice(-205);}catch{return reject('INVALID_CHANNEL_HISTORY');}
 if(data.length<101)return reject('WAIT_CHANNEL_HISTORY');
 if(data.some((b,i)=>i&&b.closeTime-data[i-1].closeTime!==STEP&&!(platform==='COLMEX'&&stockSessionGap(data[i-1].closeTime,b.closeTime))))return reject('GAPPED_CHANNEL_HISTORY');
 const signal=data.at(-1),history=data.slice(-101,-1);
 if(now<signal.closeTime||now>=signal.closeTime+STEP)return reject('CHANNEL_SIGNAL_EXPIRED');
 if(signal.closeTime<=Math.max(config.enabledAfter,entryAfter))return reject('WAIT_NEW_CHANNEL_SIGNAL');
 // Stock sessions use a trading-bar axis; only verified overnight/weekend gaps
 // are compressed. A missing intraday candle never becomes an artificial bar.
 const mapped=history.map((b,i)=>({...b,openTime:STEP*(i+1),closeTime:STEP*(i+2)}));
 const options={period:100,interval:'5m',now:102*STEP,deviations:2,requireConfirmed:true};
 const channel=globalThis.LEVI_PARALLEL.analyze(mapped,options),regression=globalThis.LEVI_REGRESSION.analyze(mapped,options);
 if(!channel.ready)return reject('WAIT_CHANNEL_PIVOTS');
 if(channel.provisional)return reject('WAIT_CHANNEL_TWO_TOUCHES');
 if(!regression.ready||!(regression.slope>0))return reject('REGRESSION_DIRECTION_BLOCK');
 const level=globalThis.LEVI_REGRESSION.levels(channel,101*STEP).upper,liveLevel=globalThis.LEVI_REGRESSION.levels(channel,102*STEP).upper;
 const regressionSignal=globalThis.LEVI_REGRESSION.levels(regression,101*STEP).middle,regressionCenter=globalThis.LEVI_REGRESSION.levels(regression,102*STEP).middle;
 if(history.at(-1).close>channel.upper||signal.close<=level)return reject('WAIT_CHANNEL_BREAKOUT');
 if(signal.close<=regressionSignal)return reject('REGRESSION_CENTER_BLOCK');
 const previous=data.slice(-21,-1);
 if([...previous,signal].some(b=>!Number.isFinite(b.volume)||b.volume<0))return reject('WAIT_VOLUME_HISTORY');
 const mean=previous.reduce((sum,b)=>sum+b.volume,0)/20,volumeRatio=mean>0?signal.volume/mean:0,meanDollarVolume=previous.reduce((sum,b)=>sum+b.volume*b.close,0)/20;
 if(volumeRatio<1.5)return reject('CHANNEL_VOLUME_LOW');
 if(meanDollarVolume<10000)return reject('CHANNEL_LIQUIDITY_LOW');
 const anchor=i=>history[Math.round(i/STEP)-1].openTime;
 const patternId=['channel',platform,anchor(channel.anchorStart),anchor(channel.anchorEnd),channel.side].join(':');
 if(used.includes(patternId))return reject('CHANNEL_PATTERN_ALREADY_USED');
 const exits=validateTradeSettings(settings),measures=qualityMeasures(data,data.length-1,price);
 if(!positive(measures.atr))return reject('WAIT_ATR_HISTORY');
 const setup={entryMode:'channel_breakout',policyVersion:CHANNEL_PRIMARY_POLICY.version,entryPolicyVersion:platform+'_'+CHANNEL_PRIMARY_POLICY.version,patternId,signalTime:signal.closeTime,signalExpiresAt:signal.closeTime+STEP,level,liveLevel,channelWidth:channel.width*2,regressionCenter,regressionSlope:regression.slope,lowTouches:channel.lowTouches,highTouches:channel.highTouches,volumeRatio,meanDollarVolume,confirmation:{time:signal.closeTime,price:signal.close},targetPrice:price*(1+exits.takeProfitPct/100),phase:'CHANNEL_BREAKOUT',buyConfirmed:true};
 try{const protection=channelProtectionSnapshot(setup,exits);if(protection)setup.channelProtection=protection;validateChannelProfitEntry(setup,price,exits);assertChannelEntry(setup,price,now,liveBar);}catch(e){return reject(e.message);}
 return {ready:true,reason:'CHANNEL_BREAKOUT_READY',phase:setup.phase,setup,quality:{...measures,volumeRatio,meanDollarVolume,regressionSlope:regression.slope},riskInput:{version:platform==='COLMEX'?COLMEX_QUALITY_POLICY.version:BINANCE_CONFIRMED_POLICY.version,atr:measures.atr,structureLow:Math.min(signal.low,level)}};
}
export function assertChannelSubmission(input,config,trade){
 if(!config.requested||!config.enabled)throw Error(config.error||'CHANNEL_PRIMARY_DISABLED');
 if(trade?.entryMode!=='channel_breakout')throw Error('CHANNEL_PRIMARY_REQUIRED');
 const check=channelEntry(input,config);if(!check.ready)throw Error(check.reason);
 for(const key of ['patternId','signalTime','level','liveLevel','regressionCenter','regressionSlope'])if(check.setup[key]!==trade.setup?.[key])throw Error('CHANNEL_SIGNAL_CHANGED');
 if(JSON.stringify(check.setup.channelProtection)!==JSON.stringify(trade.setup?.channelProtection))throw Error('CHANNEL_PROTECTION_CHANGED');
 if(trade.patternId!==check.setup.patternId)throw Error('CHANNEL_SIGNAL_CHANGED');
 return check;
}
