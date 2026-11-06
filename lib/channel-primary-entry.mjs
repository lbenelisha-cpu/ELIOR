import {conditionCollector,CHANNEL_CONDITIONS_VERSION} from './channel-condition-report.mjs';
// Closed 50-bar basis; live-price breakout with cumulative open-candle volume.
import '../regression-trend.js';
import '../parallel-channel.js';
import {validChannelLiveBar} from './channel-live-bar.mjs';
import {comparisonBars} from './entry-method-comparison.mjs';
import {regularSession,stockSessionGap} from './colmex-market-hours.mjs';
import {qualityMeasures,COLMEX_QUALITY_POLICY,BINANCE_CONFIRMED_POLICY} from './confirmed-entry-quality.mjs';
import {validateTradeSettings} from './trade-settings.mjs';
import {channelProtectionSnapshot,validateChannelProfitEntry} from './channel-profit-protection.mjs';

import {CHANNEL_CONSOLIDATION_POLICY,channelConsolidation,assertConsolidationEntry,assertSameConsolidation} from './channel-consolidation.mjs';

const STEP=300000,positive=n=>Number.isFinite(n)&&n>0;
export const CHANNEL_PRIMARY_POLICY=Object.freeze({conditionReportVersion:CHANNEL_CONDITIONS_VERSION,version:'CHANNEL_PRIMARY_INTRABAR_V2',consolidationPolicy:CHANNEL_CONSOLIDATION_POLICY,entryMode:'channel_breakout',timeframe:'5m',period:50,livePriceRule:'CURRENT_PRICE',minTouchesPerSide:2,minVolumeRatio:1.5,minMeanDollarVolume:10000,regressionRole:'RISING_AND_ABOVE_CENTER',priority:'CHANNEL_ONLY',signalValidityMs:STEP,trigger:'LIVE_PRICE',waitForBreakoutClose:false,volumeRule:'ACCUMULATED_OPEN_BAR_VS_PREVIOUS_20',signalExpiry:'BREAKOUT_BAR_CLOSE'});
export function channelEntryConfig(env={},platform='BINANCE'){
 const requested=env[platform+'_CHANNEL_PRIMARY_ENABLED']==='true',after=Date.parse(env[platform+'_CHANNEL_PRIMARY_AFTER']||'');
 return {...CHANNEL_PRIMARY_POLICY,platform,maxDataAgeMs:platform==='COLMEX'?10000:15000,requested,enabled:requested&&positive(after),enabledAfter:positive(after)?after:null,error:requested&&!positive(after)?'CHANNEL_ACTIVATION_TIME_REQUIRED':null};
}
export function assertChannelEntry(setup,price,now,liveBar){
 if(setup?.entryMode!=='channel_breakout'||setup.policyVersion!==CHANNEL_PRIMARY_POLICY.version||!['COLMEX','BINANCE'].includes(setup.platform)||setup.entryPolicyVersion!==setup.platform+'_'+CHANNEL_PRIMARY_POLICY.version||setup.period!==50||setup.livePriceRule!=='CURRENT_PRICE')throw Error('CHANNEL_SIGNAL_CHANGED');
 if(!positive(setup.signalTime)||setup.signalTime%STEP!==0||setup.signalExpiresAt!==setup.signalTime+STEP||now<setup.signalTime||now>=setup.signalExpiresAt)throw Error('CHANNEL_SIGNAL_EXPIRED');
 if(!positive(setup.level)||setup.liveLevel!==setup.level||!positive(setup.regressionCenter)||!(setup.regressionSlope>0))throw Error('CHANNEL_MODEL_INVALID');
 if(!positive(price)||price<=Math.max(setup.level,setup.regressionCenter))throw Error('CHANNEL_PRICE_INVALIDATED');
 if(!validChannelLiveBar(liveBar,now,setup.platform==='COLMEX'?10000:15000)||liveBar.openTime!==setup.signalTime||liveBar.low>price)throw Error('WAIT_CHANNEL_LIVE_BAR');
 if(!positive(setup.meanVolume)||liveBar.volume<setup.meanVolume*CHANNEL_PRIMARY_POLICY.minVolumeRatio)throw Error('CHANNEL_VOLUME_LOW');
 assertConsolidationEntry(setup.consolidation,'LONG',price,setup.signalTime);
 // The current bid can be newer than the history snapshot. A recovered wick
 // does not veto a valid current price; its low need not stay above the channel.
}
export function channelEntry({bars,price,priceAsOf,now=Date.now(),entryAfter=0,usedPatternIds=[],used=usedPatternIds,liveBar,settings={}},config={}){
 const checks=conditionCollector('LONG',now);
 const reject=reason=>({ready:false,reason,phase:'CHANNEL_PRIMARY',conditions:checks.report()});
 if(!config.enabled)return reject(config.error||'CHANNEL_PRIMARY_DISABLED');
 if(!['COLMEX','BINANCE'].includes(config.platform)||config.version!==CHANNEL_PRIMARY_POLICY.version)return reject('CHANNEL_SIGNAL_CHANGED');
 const platform=config.platform,maxAge=platform==='COLMEX'?10000:15000;
 const quoteAt=typeof priceAsOf==='number'?priceAsOf:Date.parse(priceAsOf);
 if(!positive(price)||!Number.isFinite(quoteAt)||quoteAt>now||now-quoteAt>maxAge)return reject('WAIT_FRESH_PRICE');
 if(!validChannelLiveBar(liveBar,now,maxAge))return reject('WAIT_CHANNEL_LIVE_BAR');
 if(platform==='COLMEX'&&!regularSession(liveBar.openTime))return reject('OUTSIDE_REGULAR_SESSION');
 const signalTime=liveBar.openTime;
 checks.check('new',signalTime>Math.max(config.enabledAfter,entryAfter),'WAIT_NEW_CHANNEL_SIGNAL');
 let data;try{data=comparisonBars(bars,now,platform).slice(-205);}catch{return reject(checks.failure||'INVALID_CHANNEL_HISTORY');}
 if(data.length<50)return reject(checks.failure||'WAIT_CHANNEL_HISTORY');
 if(data.some((b,i)=>i&&b.closeTime-data[i-1].closeTime!==STEP&&!(platform==='COLMEX'&&stockSessionGap(data[i-1].closeTime,b.closeTime))))return reject(checks.failure||'GAPPED_CHANNEL_HISTORY');
 if(data.at(-1).closeTime!==signalTime&&!(platform==='COLMEX'&&stockSessionGap(data.at(-1).closeTime,signalTime+STEP)))return reject(checks.failure||'GAPPED_CHANNEL_HISTORY');
 const history=data.slice(-50),mapped=history.map((b,i)=>({...b,openTime:STEP*(i+1),closeTime:STEP*(i+2)}));
 const options={period:50,interval:'5m',now:52*STEP,deviations:2,requireConfirmed:true};
 const channel=globalThis.LEVI_PARALLEL.analyze(mapped,options),regression=globalThis.LEVI_REGRESSION.analyze(mapped,options);
 const confirmed=checks.check('channel',channel.ready&&!channel.provisional,channel.ready?'WAIT_CHANNEL_TWO_TOUCHES':'WAIT_CHANNEL_PIVOTS');
 checks.check('slope',regression.ready&&regression.slope>0,'REGRESSION_DIRECTION_BLOCK');
 const level=confirmed?globalThis.LEVI_REGRESSION.levels(channel,51*STEP).upper:null;
 const regressionCenter=regression.ready?globalThis.LEVI_REGRESSION.levels(regression,51*STEP).middle:null;
 if(confirmed)checks.check('break',history.at(-1).close<=channel.upper&&price>level,'WAIT_CHANNEL_LIVE_BREAKOUT');
 if(regression.ready)checks.check('center',price>regressionCenter,'REGRESSION_CENTER_BLOCK');
 const previous=history.slice(-20),volumesValid=checks.check('volumeData',previous.every(b=>Number.isFinite(b.volume)&&b.volume>=0),'WAIT_VOLUME_HISTORY');
 const mean=volumesValid?previous.reduce((sum,b)=>sum+b.volume,0)/20:0,volumeRatio=mean>0?liveBar.volume/mean:0,meanDollarVolume=volumesValid?previous.reduce((sum,b)=>sum+b.volume*b.close,0)/20:0;
 if(volumesValid){checks.check('volume',volumeRatio>=CHANNEL_PRIMARY_POLICY.minVolumeRatio,'CHANNEL_VOLUME_LOW');checks.check('liquidity',meanDollarVolume>=CHANNEL_PRIMARY_POLICY.minMeanDollarVolume,'CHANNEL_LIQUIDITY_LOW');}
 const anchor=i=>history[Math.round(i/STEP)-1].openTime;
 const patternId=confirmed?['channel',platform,anchor(channel.anchorStart),anchor(channel.anchorEnd),channel.side].join(':'):null;
 if(confirmed)checks.check('unused',!used.includes(patternId),'CHANNEL_PATTERN_ALREADY_USED');
 const consolidation=confirmed?channelConsolidation({history,channel,side:'LONG',price,signalTime}):null;
 if(consolidation){
  checks.check('range',consolidation.passed||consolidation.reason==='WAIT_CHANNEL_CONSOLIDATION_BREAK',consolidation.reason);
  if(positive(consolidation.high))checks.check('rangeBreak',price>consolidation.high,'WAIT_CHANNEL_CONSOLIDATION_BREAK');
 }
 const measures=qualityMeasures(data,data.length-1,price);
 checks.check('atr',positive(measures.atr),'WAIT_ATR_HISTORY');
 let exits,setup;
 if(confirmed){
  setup={consolidation,entryMode:'channel_breakout',policyVersion:CHANNEL_PRIMARY_POLICY.version,entryPolicyVersion:platform+'_'+CHANNEL_PRIMARY_POLICY.version,platform,period:50,livePriceRule:'CURRENT_PRICE',patternId,signalTime,signalExpiresAt:signalTime+STEP,level,liveLevel:level,channelWidth:channel.width*2,regressionCenter,regressionSlope:regression.slope,lowTouches:channel.lowTouches,highTouches:channel.highTouches,meanVolume:mean,volumeRatio,meanDollarVolume,confirmation:{time:quoteAt,price,source:platform==='COLMEX'?'BROKER_BID_INTRABAR':'EXCHANGE_TRADE_INTRABAR'},phase:'CHANNEL_BREAKOUT',buyConfirmed:true};
  try{exits=validateTradeSettings(settings);setup.channelProtection=channelProtectionSnapshot(setup,exits);setup.targetPrice=setup.channelProtection.targetPrice;validateChannelProfitEntry(setup,price,exits);checks.check('plan',true);}catch(e){checks.check('plan',false,e.message);}
 }
 if(!checks.complete)return {...reject(checks.failure||'CHANNEL_MODEL_INVALID'),...(consolidation?{consolidation}:{})};
 // Execution still requires every gate and the final live-price/provenance guard.
 try{assertChannelEntry(setup,price,now,liveBar);}catch(e){checks.check('plan',false,e.message);return reject(e.message);}
 return {ready:true,reason:'CHANNEL_BREAKOUT_READY',conditions:checks.report(),phase:setup.phase,setup,quality:{...measures,volumeRatio,meanDollarVolume,regressionSlope:regression.slope},riskInput:{stopLossPolicy:'SETTINGS_ONLY_V1',version:platform==='COLMEX'?COLMEX_QUALITY_POLICY.version:BINANCE_CONFIRMED_POLICY.version,atr:measures.atr,structureLow:Math.min(liveBar.low,level)}};
}
export function assertChannelSubmission(input,config,trade){
 if(!config.requested||!config.enabled)throw Error(config.error||'CHANNEL_PRIMARY_DISABLED');
 if(trade?.entryMode!=='channel_breakout')throw Error('CHANNEL_PRIMARY_REQUIRED');
 const check=channelEntry(input,config);if(!check.ready)throw Error(check.reason);
 for(const key of ['platform','policyVersion','entryPolicyVersion','period','livePriceRule','patternId','signalTime','signalExpiresAt','level','liveLevel','regressionCenter','regressionSlope','meanVolume'])if(check.setup[key]!==trade.setup?.[key])throw Error('CHANNEL_SIGNAL_CHANGED');
 assertSameConsolidation(check.setup.consolidation,trade.setup?.consolidation);
 if(JSON.stringify(check.setup.channelProtection)!==JSON.stringify(trade.setup?.channelProtection))throw Error('CHANNEL_PROTECTION_CHANGED');
 if(trade.patternId!==check.setup.patternId)throw Error('CHANNEL_SIGNAL_CHANGED');
 return check;
}
