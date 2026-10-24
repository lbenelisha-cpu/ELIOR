export const DEFAULT_TRADE_SETTINGS=Object.freeze({takeProfitPct:50,stopLossPct:1,profitActivationPct:4,trailingGapPp:1});
export function validateTradeSettings(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!Object.hasOwn(DEFAULT_TRADE_SETTINGS,k)))throw Error('INVALID_SETTINGS');
 const v={...DEFAULT_TRADE_SETTINGS,...input};
 for(const [k,max]of [['takeProfitPct',500],['stopLossPct',50],['profitActivationPct',100],['trailingGapPp',50]])if(typeof v[k]!=='number'||!Number.isFinite(v[k])||v[k]<.1||v[k]>max)throw Error('INVALID_'+k);
 if(v.takeProfitPct<=v.profitActivationPct)throw Error('TAKE_PROFIT_MUST_EXCEED_ACTIVATION');return v;
}
