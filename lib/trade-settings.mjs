export const TRADE_SETTINGS_VERSION='ACTIVATE5_GAP1_V2';
export const DEFAULT_TRADE_SETTINGS=Object.freeze({takeProfitPct:50,stopLossPct:1,profitActivationPct:5,trailingGapPp:1});
export function validateTradeSettings(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!Object.hasOwn(DEFAULT_TRADE_SETTINGS,k)&&!['channelProfitProtection','channelActivationFraction'].includes(k)))throw Error('INVALID_SETTINGS');
 const v={...DEFAULT_TRADE_SETTINGS,...input};
 for(const [k,max]of [['takeProfitPct',500],['stopLossPct',50],['profitActivationPct',100],['trailingGapPp',50]])if(typeof v[k]!=='number'||!Number.isFinite(v[k])||v[k]<.1||v[k]>max)throw Error('INVALID_'+k);
 if(v.channelProfitProtection!==undefined&&typeof v.channelProfitProtection!=='boolean')throw Error('INVALID_channelProfitProtection');
 if(v.channelActivationFraction!==undefined&&(typeof v.channelActivationFraction!=='number'||!Number.isFinite(v.channelActivationFraction)||v.channelActivationFraction<=0||v.channelActivationFraction>=1))throw Error('INVALID_channelActivationFraction');
 if(v.takeProfitPct<=v.profitActivationPct)throw Error('TAKE_PROFIT_MUST_EXCEED_ACTIVATION');return v;
}
// One-time authorized policy change. Later user edits retain their own values.
export function normalizeTradeSettingsRecord(record={}){
 const values=validateTradeSettings(record.values||{}),revision=record.revision||0;
 if(record.policyVersion===TRADE_SETTINGS_VERSION)return {...record,revision,values};
 const migrated={...values,profitActivationPct:5,trailingGapPp:1};
 if(migrated.takeProfitPct<=5)migrated.takeProfitPct=DEFAULT_TRADE_SETTINGS.takeProfitPct;
 return {...record,revision:revision+(Object.keys(record).length?1:0),policyVersion:TRADE_SETTINGS_VERSION,values:validateTradeSettings(migrated)};
}
export function colmexSettingsRecord(state){
 return normalizeTradeSettingsRecord(state?{values:state.settings,revision:state.settingsRevision||0,policyVersion:state.settingsPolicyVersion}:{});
}
