import {POC_ENTRY_POLICY,pocEntry,assertSamePoc} from './channel-poc-entry.mjs';
import {validateTradeSettings} from './trade-settings.mjs';
// Preserve ledger identity; each new entry uses half the current USDT wallet.
export const FUTURES_SHORT_POLICY=Object.freeze({...POC_ENTRY_POLICY,version:'FUTURES_CHANNEL_SHORT_V1',market:'USD_M_USDT_PERPETUAL',side:'SHORT',allocationPolicy:'FUTURES_WALLET_HALF_V1',maxPositions:2,reserveUsdtPerSlot:1,leverage:1,marginType:'ISOLATED',autoAddMargin:false,livePriceRule:'CURRENT_PRICE',entryPolicyVersion:POC_ENTRY_POLICY.version,trigger:'POC_RETURN',waitForBreakoutClose:true,signalExpiry:'RETURN_BAR_CLOSE'});
const positive=n=>Number.isFinite(n)&&n>0;
export function shortAllocation(account,positions=0){
 const wallet=account?.walletUsdt,available=account?.availableUsdt;
 const valid=Number.isFinite(wallet)&&wallet>=0&&Number.isFinite(available)&&available>=0&&Number.isInteger(positions)&&positions>=0;
 const slotBudgetUsdt=valid?Math.floor(wallet*50)/100:0;
 const freeSlots=Math.max(0,2-positions);
 const maxOrderUsdt=valid&&freeSlots?Math.floor(Math.min(slotBudgetUsdt,available)*100)/100:0;
 return {policy:'FUTURES_WALLET_HALF_V1',maxPositions:2,freeSlots,slotBudgetUsdt,maxOrderUsdt,reserveUsdt:shortReserve(maxOrderUsdt),verified:valid};
}
export function shortReserve(budget){return Math.max(1,budget*.003);}
export function shortConfig(env={}){
 const requested=env.BINANCE_FUTURES_SHORT_ENABLED==='true',enabledAfter=Date.parse(env.BINANCE_FUTURES_SHORT_AFTER||'');
 return {...FUTURES_SHORT_POLICY,requested,enabled:requested&&positive(enabledAfter),enabledAfter:positive(enabledAfter)?enabledAfter:null};
}
export function shortSignal(input,config={}){
 const result=pocEntry(input,config,'SHORT');
 if(!result.ready)return {...result,consolidation:result.model?.consolidation};
 const m=result.model,width=m.channel.width*2;
 return {...result,reason:'SHORT_POC_READY',setup:{version:FUTURES_SHORT_POLICY.version,pocPolicy:POC_ENTRY_POLICY.version,entryPolicyVersion:POC_ENTRY_POLICY.version,platform:config.platform==='COLMEX'?'COLMEX':'BINANCE',period:50,livePriceRule:'CURRENT_PRICE',patternId:result.patternId,signalTime:result.signalTime,expiresAt:result.signalTime+300000,signalExpiresAt:result.signalTime+300000,
  pocModel:m,directionConfirmation:result.directionConfirmation,poc:m.profile.poc,consolidation:m.consolidation,level:m.channel.level,liveLevel:m.channel.level,width,targetPrice:m.channel.level-width,lowTouches:m.channel.lowTouches,highTouches:m.channel.highTouches}};
}
export function assertSameShortSignal(a,b){
 assertSamePoc(a,b);
 for(const key of ['version','entryPolicyVersion','platform','period','level','width','targetPrice','expiresAt'])if(a[key]!==b[key])throw Error('FUTURES_SIGNAL_CHANGED');
}
export const FUTURES_SHORT_EXIT_POLICY='FUTURES_SHORT_SETTINGS_V2';
export function validateShortSettings(input){
 const settings=validateTradeSettings(input);
 if(settings.takeProfitPct>=100)throw Error('SHORT_TP_BELOW_100_REQUIRED');
 return settings;
}
// The default retains Colmex's channel target. Binance explicitly selects SETTINGS.
export function shortExit(position,price,input,{targetMode='CHANNEL'}={}){
 const settings=validateTradeSettings(input);
 if(!positive(position.entryPrice)||!positive(position.targetPrice)||!positive(price))throw Error('INVALID_SHORT_POSITION');
 const entry=position.entryPrice;
 const fromSettings=targetMode==='SETTINGS'||position.setup?.entryMode==='POC';
 if(targetMode==='SETTINGS')validateShortSettings(settings);
 const targetPrice=fromSettings?entry*(1-settings.takeProfitPct/100):position.targetPrice;
 if(!positive(targetPrice))throw Error('POC_SHORT_TP_BELOW_100_REQUIRED');
 const low=Math.min(entry,position.lowPrice??entry,price);
 const activation=entry*(1-settings.profitActivationPct/100);
 const armed=position.armed===true||low<=activation;
 const stop=Math.min(entry*(1+settings.stopLossPct/100),position.stopPrice??Infinity,armed?low+entry*settings.trailingGapPp/100:Infinity);
 return {...position,targetPrice,targetSource:fromSettings?'SETTINGS':'CHANNEL',lowPrice:low,armed,stopPrice:stop,activationPrice:activation,settings,
  exit:price<=targetPrice?(fromSettings?'SETTINGS_TAKE_PROFIT':'CHANNEL_TAKE_PROFIT'):price>=stop?(armed?'TRAILING_STOP':'STOP_LOSS'):null};
}
export function roundStep(value,step,up=false){
 step=Number(step);if(!positive(value)||!positive(step))throw Error('INVALID_FUTURES_FILTER');
 const decimals=Math.max(0,(step.toString().split('e')[0].split('.')[1]?.length||0)-Number(step.toString().split('e')[1]||0));
 if(decimals>12)throw Error('INVALID_FUTURES_FILTER');
 return ((up?Math.ceil:Math.floor)(value/step+(up?-1e-9:1e-9))*step).toFixed(decimals);
}
export function shortOrderPlan(info,quote,setup,budget=35){
 if(info?.contractType!=='PERPETUAL'||info.quoteAsset!=='USDT'||info.marginAsset!=='USDT'||info.status!=='TRADING')throw Error('UNSUPPORTED_FUTURES_CONTRACT');
 const bid=Number(quote.bidPrice),ask=Number(quote.askPrice);
 if(!positive(bid)||!positive(ask)||ask<bid||(ask/bid-1)>.003)throw Error('FUTURES_SPREAD_BLOCK');
 const lot=info.filters?.find(f=>f.filterType==='LOT_SIZE'),tick=info.filters?.find(f=>f.filterType==='PRICE_FILTER');
 const minimum=Number(info.filters?.find(f=>f.filterType==='MIN_NOTIONAL')?.notional);
 if(!positive(minimum)||!positive(Number(lot?.minQty))||!positive(Number(lot?.maxQty)))throw Error('INVALID_FUTURES_FILTER');
 // Reserve is inside each equal slot. No borrowing, transfer, leverage escalation or resizing upward.
 if(!positive(budget)||budget<5)throw Error('FUTURES_ALLOCATION_INSUFFICIENT');
 const cap=budget-shortReserve(budget);
 const quantity=roundStep(cap/(ask*1.001),lot.stepSize),price=roundStep(bid*.999,tick?.tickSize);
 const target=Number(roundStep(setup.targetPrice,tick.tickSize,true));
 if(Number(quantity)<Number(lot.minQty)||Number(quantity)>Number(lot.maxQty)||Number(quantity)*Number(price)<minimum)throw Error('FUTURES_MIN_NOTIONAL_OR_QUANTITY');
 if(!['CHANNEL_POC_RETEST_V1','CHANNEL_POC_RETEST_V2'].includes(setup.pocPolicy)&&Number(price)<=target)throw Error('SHORT_TARGET_ALREADY_REACHED');
 return {symbol:info.symbol,side:'SELL',positionSide:'BOTH',type:'LIMIT',timeInForce:'IOC',quantity,price,newOrderRespType:'RESULT'};
}
