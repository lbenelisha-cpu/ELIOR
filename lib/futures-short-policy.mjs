import {regularSession,stockSessionGap} from './colmex-market-hours.mjs';
import {validChannelLiveBar} from './channel-live-bar.mjs';
import '../regression-trend.js';
import '../parallel-channel.js';
import {comparisonBars} from './entry-method-comparison.mjs';
import {validateTradeSettings} from './trade-settings.mjs';

import {CHANNEL_CONSOLIDATION_POLICY,channelConsolidation,assertSameConsolidation} from './channel-consolidation.mjs';

export const FUTURES_SHORT_POLICY=Object.freeze({version:'FUTURES_CHANNEL_SHORT_V1',consolidationPolicy:CHANNEL_CONSOLIDATION_POLICY,market:'USD_M_USDT_PERPETUAL',side:'SHORT',budgetUsdt:70,maxPositions:2,slotBudgetUsdt:35,reserveUsdtPerSlot:1,leverage:1,marginType:'ISOLATED',autoAddMargin:false,timeframe:'5m',period:50,livePriceRule:'CURRENT_PRICE',entryPolicyVersion:'FUTURES_CHANNEL_SHORT_INTRABAR_V2',trigger:'LIVE_PRICE',waitForBreakoutClose:false,volumeRule:'ACCUMULATED_OPEN_BAR_VS_PREVIOUS_20',signalExpiry:'BREAKOUT_BAR_CLOSE'});
const STEP=300000,positive=n=>Number.isFinite(n)&&n>0;
export function shortConfig(env={}){
 const requested=env.BINANCE_FUTURES_SHORT_ENABLED==='true',enabledAfter=Date.parse(env.BINANCE_FUTURES_SHORT_AFTER||'');
 return {...FUTURES_SHORT_POLICY,requested,enabled:requested&&positive(enabledAfter),enabledAfter:positive(enabledAfter)?enabledAfter:null};
}
export function shortSignal({bars,price,priceAsOf,liveBar,now=Date.now(),entryAfter=0,used=[]},config){
 const no=reason=>({ready:false,reason});
 const platform=config?.platform==='COLMEX'?'COLMEX':'BINANCE';
 if(!config?.enabled)return no('FUTURES_SHORT_DISABLED');
 if(!positive(price)||!Number.isFinite(priceAsOf)||priceAsOf>now||now-priceAsOf>10000)return no('WAIT_FRESH_FUTURES_PRICE');
 if(!validChannelLiveBar(liveBar,now))return no('WAIT_FUTURES_LIVE_BAR');
 let data;try{data=comparisonBars(bars,now,platform).slice(-205);}catch{return no('INVALID_FUTURES_HISTORY');}
 if(data.length<FUTURES_SHORT_POLICY.period)return no('WAIT_FUTURES_HISTORY');
 if(data.some((b,i)=>i&&b.closeTime-data[i-1].closeTime!==STEP&&!(platform==='COLMEX'&&stockSessionGap(data[i-1].closeTime,b.closeTime))))return no('GAPPED_FUTURES_HISTORY');
 const signal=liveBar,history=data.slice(-FUTURES_SHORT_POLICY.period);
 if(platform==='COLMEX'&&!regularSession(signal.openTime))return no('OUTSIDE_REGULAR_SESSION');
 if(data.at(-1).closeTime!==signal.openTime&&!(platform==='COLMEX'&&stockSessionGap(data.at(-1).closeTime,signal.openTime+STEP)))return no('GAPPED_FUTURES_HISTORY');
 if(signal.openTime<=Math.max(config.enabledAfter,entryAfter))return no('WAIT_NEW_SHORT_SIGNAL');
 const mapped=history.map((b,i)=>({...b,openTime:STEP*(i+1),closeTime:STEP*(i+2)}));
 const options={period:FUTURES_SHORT_POLICY.period,interval:'5m',now:(FUTURES_SHORT_POLICY.period+2)*STEP,deviations:2,requireConfirmed:true};
 const channel=globalThis.LEVI_PARALLEL.analyze(mapped,options),regression=globalThis.LEVI_REGRESSION.analyze(mapped,options);
 if(!channel.ready||channel.provisional)return no('WAIT_TWO_TOUCHES_PER_SIDE');
 if(!regression.ready||!(regression.slope<0))return no('SHORT_REGRESSION_DIRECTION_BLOCK');
 const levels=globalThis.LEVI_REGRESSION.levels;
 const level=levels(channel,(FUTURES_SHORT_POLICY.period+1)*STEP).lower,liveLevel=level;
 const center=levels(regression,(FUTURES_SHORT_POLICY.period+1)*STEP).middle,liveCenter=center;
 if(history.at(-1).close<channel.lower||price>=level)return no('WAIT_LOWER_CHANNEL_LIVE_BREAK');
 if(price>=center)return no('SHORT_REGRESSION_CENTER_BLOCK');
 const previous=history.slice(-20);
 if([...previous,signal].some(b=>!Number.isFinite(b.volume)||b.volume<0))return no('WAIT_VOLUME_HISTORY');
 const mean=previous.reduce((s,b)=>s+b.volume,0)/20;
 const volumeRatio=mean>0?signal.volume/mean:0,meanDollarVolume=previous.reduce((s,b)=>s+b.volume*b.close,0)/20;
 if(volumeRatio<1.5)return no('SHORT_VOLUME_LOW');
 if(meanDollarVolume<10000)return no('SHORT_LIQUIDITY_LOW');
 const ceiling=Math.min(level,liveLevel,liveCenter);
 if(price>=ceiling||!liveBar||liveBar.openTime!==Math.floor(now/STEP)*STEP||!positive(liveBar.high)||liveBar.high<price)return no('SHORT_PRICE_INVALIDATED');
 const width=channel.width*2,targetPrice=level-width;
 if(!positive(width)||!positive(targetPrice)||price<=targetPrice)return no('SHORT_TARGET_ALREADY_REACHED');
 const anchor=i=>history[Math.round(i/STEP)-1].openTime;
 const patternId=['short',anchor(channel.anchorStart),anchor(channel.anchorEnd),channel.side].join(':');
 if(used.includes(patternId))return no('SHORT_PATTERN_ALREADY_USED');
 const consolidation=channelConsolidation({history,channel,side:'SHORT',price,signalTime:signal.openTime});
 if(!consolidation.passed)return {...no(consolidation.reason),consolidation};
 return {ready:true,reason:'SHORT_CHANNEL_READY',setup:{consolidation,version:FUTURES_SHORT_POLICY.version,entryPolicyVersion:FUTURES_SHORT_POLICY.entryPolicyVersion,period:FUTURES_SHORT_POLICY.period,livePriceRule:FUTURES_SHORT_POLICY.livePriceRule,patternId,signalTime:signal.openTime,expiresAt:signal.closeTime,level,liveLevel,regressionCenter:liveCenter,regressionSlope:regression.slope,width,targetPrice,volumeRatio,meanDollarVolume,lowTouches:channel.lowTouches,highTouches:channel.highTouches}};
}
// Cumulative live volume can increase between reads. Revalidate its gate on
// every read, but compare only the frozen geometry and policy for provenance.
export function assertSameShortSignal(a,b){
 assertSameConsolidation(a?.consolidation,b?.consolidation);
 if(a?.entryPolicyVersion!==FUTURES_SHORT_POLICY.entryPolicyVersion||b?.entryPolicyVersion!==FUTURES_SHORT_POLICY.entryPolicyVersion)throw Error('FUTURES_SIGNAL_CHANGED');
 for(const key of ['version','entryPolicyVersion','period','livePriceRule','patternId','signalTime','expiresAt','level','liveLevel','regressionCenter','regressionSlope','width','targetPrice','meanDollarVolume','lowTouches','highTouches'])if(a[key]!==b[key])throw Error('FUTURES_SIGNAL_CHANGED');
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
 const cap=Math.min(35,budget)-1;
 const quantity=roundStep(cap/(ask*1.001),lot.stepSize),price=roundStep(bid*.999,tick?.tickSize);
 const target=Number(roundStep(setup.targetPrice,tick.tickSize,true));
 if(Number(quantity)<Number(lot.minQty)||Number(quantity)>Number(lot.maxQty)||Number(quantity)*Number(price)<minimum)throw Error('FUTURES_MIN_NOTIONAL_OR_QUANTITY');
 if(Number(price)<=target)throw Error('SHORT_TARGET_ALREADY_REACHED');
 return {symbol:info.symbol,side:'SELL',positionSide:'BOTH',type:'LIMIT',timeInForce:'IOC',quantity,price,newOrderRespType:'RESULT'};
}
