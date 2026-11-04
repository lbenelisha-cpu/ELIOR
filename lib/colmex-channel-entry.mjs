import {channelEntry,assertChannelSubmission} from './channel-primary-entry.mjs';
import {shortSignal,assertSameShortSignal,FUTURES_SHORT_POLICY} from './futures-short-policy.mjs';
import {validChannelLiveBar} from './channel-live-bar.mjs';
function colmexShortSignal(input,config){
 const prefix='colmex:'+input.symbol+':';
 const used=(input.used||[]).filter(id=>id.startsWith(prefix)).map(id=>id.slice(prefix.length));
 const signal=shortSignal({...input,used,price:input.ask},config);
 if(signal.ready)signal.setup.patternId=prefix+signal.setup.patternId;
 return signal;
}

// Reuse the actual Binance evaluators, including their geometry, volume gates,
// target distance and consumed-pattern checks. Stock session gaps are allowed.
export function colmexChannelSignal(input,config){
 const long=channelEntry(input,config);
 if(long.ready)return {...long,side:'LONG'};
 const short=colmexShortSignal(input,config);
 if(short.ready)return {...short,side:'SHORT',setup:{...short.setup,entryMode:'channel_short',platform:'COLMEX',side:'SHORT'}};
 return {...long,reason:long.reason==='REGRESSION_DIRECTION_BLOCK'?short.reason:long.reason,directions:{LONG:long.reason,SHORT:short.reason}};
}
export function assertColmexChannelSubmission(input,config,intent){
 if(intent.setup?.entryMode!=='channel_short')return assertChannelSubmission(input,config,{...intent,entryMode:intent.setup?.entryMode});
 if(!config.requested||!config.enabled)throw Error(config.error||'CHANNEL_PRIMARY_DISABLED');
 const check=colmexShortSignal(input,config);
 if(!check.ready)throw Error(check.reason);
 assertSameShortSignal(intent.setup,check.setup);
 if(intent.patternId!==check.setup.patternId)throw Error('FUTURES_SIGNAL_CHANGED');
 return {...check,side:'SHORT',setup:{...check.setup,entryMode:'channel_short',platform:'COLMEX',side:'SHORT'}};
}
export function assertColmexShortEntry(setup,ask,now,liveBar){
 if(setup?.entryMode!=='channel_short'||setup.platform!=='COLMEX'||setup.entryPolicyVersion!==FUTURES_SHORT_POLICY.entryPolicyVersion||setup.version!==FUTURES_SHORT_POLICY.version)throw Error('FUTURES_SIGNAL_CHANGED');
 if(!Number.isFinite(setup.signalTime)||now<setup.signalTime||now>=setup.expiresAt||setup.expiresAt!==setup.signalTime+300000)throw Error('SHORT_SIGNAL_EXPIRED');
 if(!validChannelLiveBar(liveBar,now,10000)||liveBar.openTime!==setup.signalTime)throw Error('WAIT_FUTURES_LIVE_BAR');
 if(!(Number.isFinite(ask)&&ask>0&&ask<setup.level&&ask<setup.regressionCenter&&setup.regressionSlope<0&&ask>setup.targetPrice))throw Error('SHORT_PRICE_INVALIDATED');
}
