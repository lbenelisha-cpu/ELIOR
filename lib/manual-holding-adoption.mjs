import {accountTradeActions} from './binance-external-cost.mjs';
import {liveBalancePnl} from './wyckoff-live-positions.mjs';
import {applyTrailingExitPolicy} from './trailing-profit-exit.mjs';
export function externalBinanceEntry(balance,trades,now=Date.now(),prior=null,settings={}){
 const symbol=balance.asset+'USDT';
 if(['USDT','USDC'].includes(balance.asset)||!(balance.valueUsdt>=5))return null;
 const actions=accountTradeActions(symbol,trades),cost=liveBalancePnl(balance,actions);
 if(!(cost.entryPrice>0&&balance.qty>0))throw Error('MANUAL_HOLDING_COST_NOT_VERIFIED');
 const buy=[...trades].filter(t=>t.isBuyer).sort((a,b)=>b.time-a.time||b.id-a.id)[0];
 if(!buy||!(Number(buy.time)>0))throw Error('MANUAL_HOLDING_TIME_NOT_VERIFIED');
 const at=new Date(now).toISOString(),p=applyTrailingExitPolicy({strategyId:'WYCKOFF_5M_V1',entryMode:'manual_external',entryPrice:cost.entryPrice,qty:balance.qty,peakPrice:Math.max(cost.entryPrice,Number(balance.usdtPrice)||0),entryAt:at,sourcePurchaseAt:new Date(Number(buy.time)).toISOString(),adoptedAt:at},settings);
 if(prior?.effectiveStopPrice>p.effectiveStopPrice){p.effectiveStopPrice=prior.effectiveStopPrice;applyTrailingExitPolicy(p);}
 return {type:'BUY',symbol,qty:balance.qty,price:cost.entryPrice,amountUsdt:cost.entryPrice*balance.qty,commissions:[],quoteFeeUsdt:0,orderId:'manual-adoption-'+symbol+'-'+buy.id+'-'+String(balance.qty),at,reason:'MANUAL_HOLDING_ADOPTED',status:'ADOPTED',replaceWalletQuantity:true,sourcePurchaseAt:p.sourcePurchaseAt,wyckoffTrade:p};
}
