import {applyTrailingExitPolicy} from './trailing-profit-exit.mjs';
import {binancePositionExit} from './binance-position-exit.mjs';
import {shortExit} from './futures-short-policy.mjs';
export const isColmexShort=p=>p?.side==='SHORT';
export function applyColmexExitPolicy(p,settings=p.exitSettings||{}){
 if(!isColmexShort(p))return applyTrailingExitPolicy(p,settings);
 const short=shortExit({...p,targetPrice:p.setup?.targetPrice??p.targetPrice,lowPrice:p.lowPrice??p.entryPrice,armed:p.profitFloorArmed,stopPrice:p.effectiveStopPrice},p.lastAsk??p.entryPrice,settings);
 Object.assign(p,{exitSettings:short.settings,exitPolicy:'COLMEX_CHANNEL_SHORT_EXIT_V1',lowPrice:short.lowPrice,profitFloorArmed:short.armed,effectiveStopPrice:short.stopPrice,stopPrice:p.entryPrice*(1+short.settings.stopLossPct/100),targetPrice:short.targetPrice,activationPrice:short.activationPrice,stopLossPct:short.settings.stopLossPct,profitActivationPct:short.profitActivationPct,trailingGapPp:short.settings.trailingGapPp,takeProfitPct:(1-short.targetPrice/p.entryPrice)*100,protectedGainPct:(1-short.stopPrice/p.entryPrice)*100});
 return p;
}
export function colmexPositionExit(p,price,now){
 if(!isColmexShort(p))return binancePositionExit(p,price,now);
 if(price<(p.lowPrice??p.entryPrice))p.lowAt=new Date(now).toISOString();
 p.lastAsk=price;applyColmexExitPolicy(p);
 if(price>=p.effectiveStopPrice)return {sell:true,reason:p.profitFloorArmed?'SHORT_TRAILING_PROFIT_EXIT':'SHORT_STOP_LOSS'};
 if(price<=p.targetPrice)return {sell:true,reason:'SHORT_TAKE_PROFIT'};
 return {sell:false,reason:'SHORT_HOLD'};
}
