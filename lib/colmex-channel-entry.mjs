import {channelEntry,assertChannelSubmission} from './channel-primary-entry.mjs';
import {shortSignal,assertSameShortSignal,FUTURES_SHORT_POLICY} from './futures-short-policy.mjs';
import {assertPocEntry} from './channel-poc-entry.mjs';
import {validChannelLiveBar} from './channel-live-bar.mjs';
function colmexShortSignal(input,config){
 const prefix='colmex:'+input.symbol+':';
 const used=(input.used||[]).filter(id=>id.startsWith(prefix)).map(id=>id.slice(prefix.length));
 const signal=shortSignal({...input,used,price:input.ask},config);
 if(signal.ready)signal.setup.patternId=prefix+signal.setup.patternId;
 return signal;
}

// One four-condition POC policy on both venues; stock sessions remain authoritative.
export function colmexChannelSignal(input,config){
 const long=channelEntry(input,config),short=colmexShortSignal(input,config);
 const conditionReports={LONG:long.conditions,SHORT:short.conditions};
 if(long.ready)return {...long,conditionReports,side:'LONG'};
 if(short.ready)return {...short,conditionReports,side:'SHORT',setup:{...short.setup,entryMode:'channel_short',platform:'COLMEX',side:'SHORT'}};
 const selected=(short.model?.frozenAt||0)>(long.model?.frozenAt||0)?short:long;
 return {...selected,conditionReports,directions:{LONG:long.reason,SHORT:short.reason}};
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
 assertPocEntry(setup,ask,now,liveBar);
}
