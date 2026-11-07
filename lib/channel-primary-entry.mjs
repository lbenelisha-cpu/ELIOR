import {POC_ENTRY_POLICY,pocEntry,assertPocEntry,assertSamePoc} from './channel-poc-entry.mjs';
import {validateTradeSettings} from './trade-settings.mjs';
import {channelProtectionSnapshot} from './channel-profit-protection.mjs';
import {COLMEX_QUALITY_POLICY,BINANCE_CONFIRMED_POLICY} from './confirmed-entry-quality.mjs';
export const CHANNEL_PRIMARY_POLICY=Object.freeze({...POC_ENTRY_POLICY,entryMode:'channel_breakout',livePriceRule:'CURRENT_PRICE',minTouchesPerSide:2,priority:'CHANNEL_ONLY',trigger:'POC_RETURN',waitForBreakoutClose:true,signalExpiry:'RETURN_BAR_CLOSE'});
export function channelEntryConfig(env={},platform='BINANCE'){
 const requested=env[platform+'_CHANNEL_PRIMARY_ENABLED']==='true',after=Date.parse(env[platform+'_CHANNEL_PRIMARY_AFTER']||'');
 return {...CHANNEL_PRIMARY_POLICY,platform,maxDataAgeMs:platform==='COLMEX'?10000:15000,requested,enabled:requested&&Number.isFinite(after)&&after>0,enabledAfter:Number.isFinite(after)&&after>0?after:null,error:requested&&!(after>0)?'CHANNEL_ACTIVATION_TIME_REQUIRED':null};
}
export function assertChannelEntry(setup,price,now,liveBar){
 if(setup?.entryMode!=='channel_breakout'||setup.policyVersion!==CHANNEL_PRIMARY_POLICY.version||setup.entryPolicyVersion!==setup.platform+'_'+CHANNEL_PRIMARY_POLICY.version)throw Error('CHANNEL_SIGNAL_CHANGED');
 assertPocEntry(setup,price,now,liveBar);
}
export function channelEntry(input,config={}){
 if(config.enabled&&(!['BINANCE','COLMEX'].includes(config.platform)||config.version!==CHANNEL_PRIMARY_POLICY.version))return {ready:false,reason:'CHANNEL_SIGNAL_CHANGED'};
 const result=pocEntry(input,config,'LONG');
 if(!result.ready)return {...result,phase:'CHANNEL_POC',consolidation:result.model?.consolidation};
 const m=result.model,settings=validateTradeSettings(input.settings||{}),price=input.price;
 const setup={entryMode:'channel_breakout',policyVersion:CHANNEL_PRIMARY_POLICY.version,pocPolicy:CHANNEL_PRIMARY_POLICY.version,entryPolicyVersion:config.platform+'_'+CHANNEL_PRIMARY_POLICY.version,platform:config.platform,period:50,livePriceRule:'CURRENT_PRICE',patternId:result.patternId,signalTime:result.signalTime,signalExpiresAt:result.signalTime+300000,
  pocModel:m,poc:m.profile.poc,consolidation:m.consolidation,level:m.channel.level,liveLevel:m.channel.level,channelWidth:m.channel.width*2,lowTouches:m.channel.lowTouches,highTouches:m.channel.highTouches,phase:'CHANNEL_POC_RETEST',buyConfirmed:true};
 setup.channelProtection=channelProtectionSnapshot(setup,settings);setup.targetPrice=setup.channelProtection.targetPrice;
 assertChannelEntry(setup,price,input.now??Date.now(),input.liveBar);
 return {...result,reason:'CHANNEL_POC_READY',phase:setup.phase,setup,quality:{poc:setup.poc,profileMethod:m.profile.method},riskInput:{stopLossPolicy:'SETTINGS_ONLY_V1',version:config.platform==='COLMEX'?COLMEX_QUALITY_POLICY.version:BINANCE_CONFIRMED_POLICY.version,source:CHANNEL_PRIMARY_POLICY.version}};
}
export function assertChannelSubmission(input,config,trade){
 if(!config.requested||!config.enabled)throw Error(config.error||'CHANNEL_PRIMARY_DISABLED');
 if(trade?.entryMode!=='channel_breakout')throw Error('CHANNEL_PRIMARY_REQUIRED');
 const check=channelEntry(input,config);if(!check.ready)throw Error(check.reason);
 assertSamePoc(check.setup,trade.setup);
 if(trade.patternId!==check.setup.patternId)throw Error('CHANNEL_SIGNAL_CHANGED');
 if(JSON.stringify(check.setup.channelProtection)!==JSON.stringify(trade.setup?.channelProtection))throw Error('CHANNEL_PROTECTION_CHANGED');
 return check;
}
