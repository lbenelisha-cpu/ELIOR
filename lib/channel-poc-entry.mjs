import '../regression-trend.js';
import '../parallel-channel.js';
import '../channel-poc-model.js';
import {comparisonBars} from './entry-method-comparison.mjs';
import {regularSession,stockSessionGap} from './colmex-market-hours.mjs';
import {validChannelLiveBar} from './channel-live-bar.mjs';
export const POC_MODEL=globalThis.LEVI_CHANNEL_POC;
export const POC_ENTRY_POLICY=Object.freeze({version:POC_MODEL.VERSION,anchorPolicy:POC_MODEL.ANCHOR_POLICY,conditionReportVersion:POC_MODEL.REPORT,period:50,timeframe:'5m',consolidationPolicy:POC_MODEL.consolidationPolicy,entryTrigger:'RETURN_TO_FROZEN_POC',profileMethod:'OHLC_UNIFORM_ESTIMATE',profileBins:32,profileEnd:'WAVE_EXTREME_CLOSED_BAR',requiredConditions:[1,3,4,8],removedConditions:[2,5,6,7,9,10],regressionRole:'DISPLAY_ONLY'});
export function pocEntry(input,config,side){
 const {price,liveBar,now=Date.now()}=input,platform=config.platform==='COLMEX'?'COLMEX':'BINANCE',maxAge=platform==='COLMEX'?10000:15000;
 const at=typeof input.priceAsOf==='number'?input.priceAsOf:Date.parse(input.priceAsOf);
 const empty={version:POC_MODEL.REPORT,side,at:now,expiresAt:(Math.floor(now/300000)+1)*300000,rows:['channel','break','poc','range'].map(id=>({id,state:'unknown'})),model:null};
 const reject=reason=>({ready:false,reason,conditions:empty});
 if(!config.enabled)return reject(config.error||'CHANNEL_PRIMARY_DISABLED');
 if(!(Number.isFinite(price)&&price>0&&Number.isFinite(at)&&at<=now&&now-at<=maxAge))return reject('WAIT_FRESH_PRICE');
 if(!validChannelLiveBar(liveBar,now,maxAge))return reject('WAIT_CHANNEL_LIVE_BAR');
 let data;try{data=comparisonBars(input.bars,now,platform);}catch{return reject('INVALID_CHANNEL_HISTORY');}
 if(data.length<50)return reject('WAIT_CHANNEL_HISTORY');
 const follows=(a,b)=>b===a||platform==='COLMEX'&&stockSessionGap(a,b+300000);
 if(data.some((b,i)=>i&&!follows(data[i-1].closeTime,b.openTime))||!follows(data.at(-1).closeTime,liveBar.openTime))return reject('GAPPED_CHANNEL_HISTORY');
 if(platform==='COLMEX'&&!regularSession(liveBar.openTime))return reject('OUTSIDE_REGULAR_SESSION');
 const result=POC_MODEL.analyze({...input,bars:data,now,side});
 // An identical order event is not another purchase. Later returns to the same
 // channel receive a different receipt; there is no consumed-channel-pattern filter.
 if(result.model){
  result.patternId=result.model.id+':return:'+liveBar.openTime;
  result.signalTime=liveBar.openTime;
  const used=input.used||input.usedPatternIds||[];
  if(used.includes(result.patternId)||liveBar.openTime<=Number(input.entryAfter||0))return {...result,ready:false,reason:'POC_RETURN_ALREADY_EXECUTED',executionBlock:'DUPLICATE_RETURN_RECEIPT'};
 }
 return result;
}
export function assertPocEntry(setup,price,now,liveBar){
 const m=setup?.pocModel,side=m?.side,pc=m?.profile?.poc;
 if(setup?.pocPolicy!==POC_MODEL.VERSION||m?.version!==POC_MODEL.VERSION||m?.anchorPolicy!==POC_MODEL.ANCHOR_POLICY||!['LONG','SHORT'].includes(side)||!(pc>0)||m.consolidation?.passed!==true||m.consolidation?.version!==POC_MODEL.consolidationPolicy.version||!(m.channel?.lowTouches>=2&&m.channel?.highTouches>=2)||m.frozenAt>setup.signalTime)throw Error('POC_MODEL_CHANGED');
 if(!validChannelLiveBar(liveBar,now,setup.platform==='COLMEX'?10000:15000)||liveBar.openTime!==setup.signalTime||now>=setup.signalExpiresAt)throw Error('WAIT_CHANNEL_LIVE_BAR');
 if(!(Number.isFinite(price)&&price>0)||(side==='LONG'?price>pc||liveBar.low>pc:price<pc||liveBar.high<pc))throw Error('POC_PRICE_INVALIDATED');
}
export function assertSamePoc(a,b){
 for(const key of ['platform','period','livePriceRule','pocPolicy','poc','level','liveLevel','policyVersion','entryPolicyVersion'])if(a?.[key]!==b?.[key])throw Error('POC_MODEL_CHANGED');
 if(a?.pocPolicy!==POC_MODEL.VERSION||b?.pocPolicy!==POC_MODEL.VERSION||JSON.stringify(a.pocModel)!==JSON.stringify(b.pocModel)||a.patternId!==b.patternId||a.signalTime!==b.signalTime||a.signalExpiresAt!==b.signalExpiresAt)throw Error('POC_MODEL_CHANGED');
}
