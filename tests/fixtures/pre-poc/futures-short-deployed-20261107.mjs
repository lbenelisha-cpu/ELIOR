import {conditionCollector,CHANNEL_CONDITIONS_VERSION} from './channel-condition-report.mjs';
import {validChannelLiveBar} from './channel-live-bar.mjs';
import '../regression-trend.js';
import '../parallel-channel.js';
import {comparisonBars} from './entry-method-comparison.mjs';
import {validateTradeSettings} from './trade-settings.mjs';

import {CHANNEL_CONSOLIDATION_POLICY,channelConsolidation,assertSameConsolidation} from './channel-consolidation.mjs';

export const FUTURES_SHORT_POLICY=Object.freeze({conditionReportVersion:CHANNEL_CONDITIONS_VERSION,version:'FUTURES_CHANNEL_SHORT_V1',consolidationPolicy:CHANNEL_CONSOLIDATION_POLICY,market:'USD_M_USDT_PERPETUAL',side:'SHORT',budgetUsdt:70,maxPositions:2,slotBudgetUsdt:35,reserveUsdtPerSlot:1,leverage:1,marginType:'ISOLATED',autoAddMargin:false,timeframe:'5m',period:50,livePriceRule:'CURRENT_PRICE',entryPolicyVersion:'FUTURES_CHANNEL_SHORT_INTRABAR_V2',trigger:'LIVE_PRICE',waitForBreakoutClose:false,volumeRule:'ACCUMULATED_OPEN_BAR_VS_PREVIOUS_20',signalExpiry:'BREAKOUT_BAR_CLOSE'});
const STEP=300000,positive=n=>Number.isFinite(n)&&n>0;
export function shortConfig(env={}){
 const requested=env.BINANCE_FUTURES_SHORT_ENABLED==='true',enabledAfter=Date.parse(env.BINANCE_FUTURES_SHORT_AFTER||'');
 const entryMode=env.BINANCE_FUTURES_SHORT_STRATEGY==='POC'?'POC_AUTO':'CHANNEL';
 return {...FUTURES_SHORT_POLICY,requested,enabled:requested&&positive(enabledAfter),enabledAfter:positive(enabledAfter)?enabledAfter:null,entryMode};
}
export function shortSignal({bars,price,priceAsOf,liveBar,now=Date.now(),entryAfter=0,used=[]},config){
 const checks=conditionCollector('SHORT',now),no=reason=>({ready:false,reason,conditions:checks.report()});
 if(!config?.enabled)return no('FUTURES_SHORT_DISABLED');
 if(!positive(price)||!Number.isFinite(priceAsOf)||priceAsOf>now||now-priceAsOf>10000)return no('WAIT_FRESH_FUTURES_PRICE');
 if(!validChannelLiveBar(liveBar,now))return no('WAIT_FUTURES_LIVE_BAR');
 let data;try{data=comparisonBars(bars,now,'BINANCE').slice(-205);}catch{return no('INVALID_FUTURES_HISTORY');}
 if(data.length<FUTURES_SHORT_POLICY.period)return no('WAIT_FUTURES_HISTORY');
 if(data.some((b,i)=>i&&b.closeTime-data[i-1].closeTime!==STEP))return no('GAPPED_FUTURES_HISTORY');
 const signal=liveBar,history=data.slice(-FUTURES_SHORT_POLICY.period);
 if(data.at(-1).closeTime!==signal.openTime)return no('GAPPED_FUTURES_HISTORY');
 checks.check('new',signal.openTime>Math.max(config.enabledAfter,entryAfter),'WAIT_NEW_SHORT_SIGNAL');
 const mapped=history.map((b,i)=>({...b,openTime:STEP*(i+1),closeTime:STEP*(i+2)}));
 const options={period:FUTURES_SHORT_POLICY.period,interval:'5m',now:(FUTURES_SHORT_POLICY.period+2)*STEP,deviations:2,requireConfirmed:true};
 const channel=globalThis.LEVI_PARALLEL.analyze(mapped,options),regression=globalThis.LEVI_REGRESSION.analyze(mapped,options);
 const confirmed=checks.check('channel',channel.ready&&!channel.provisional,'WAIT_TWO_TOUCHES_PER_SIDE');
 checks.check('slope',regression.ready&&regression.slope<0,'SHORT_REGRESSION_DIRECTION_BLOCK');
 const levels=globalThis.LEVI_REGRESSION.levels;
 const level=confirmed?levels(channel,(FUTURES_SHORT_POLICY.period+1)*STEP).lower:null,liveLevel=level;
 const center=regression.ready?levels(regression,(FUTURES_SHORT_POLICY.period+1)*STEP).middle:null,liveCenter=center;
 if(confirmed)checks.check('break',history.at(-1).close>=channel.lower&&price<level,'WAIT_LOWER_CHANNEL_LIVE_BREAK');
 if(regression.ready)checks.check('center',price<center,'SHORT_REGRESSION_CENTER_BLOCK');
 const previous=history.slice(-20),volumesValid=checks.check('volumeData',[...previous,signal].every(b=>Number.isFinite(b.volume)&&b.volume>=0),'WAIT_VOLUME_HISTORY');
 const mean=volumesValid?previous.reduce((s,b)=>s+b.volume,0)/20:0;
 const volumeRatio=mean>0?signal.volume/mean:0,meanDollarVolume=volumesValid?previous.reduce((s,b)=>s+b.volume*b.close,0)/20:0;
 if(volumesValid){checks.check('volume',volumeRatio>=1.5,'SHORT_VOLUME_LOW');checks.check('liquidity',meanDollarVolume>=10000,'SHORT_LIQUIDITY_LOW');}
 if(confirmed&&regression.ready)checks.check('price',price<Math.min(level,liveLevel,liveCenter)&&liveBar.openTime===Math.floor(now/STEP)*STEP&&positive(liveBar.high)&&liveBar.high>=price,'SHORT_PRICE_INVALIDATED');
 const width=confirmed?channel.width*2:null,targetPrice=confirmed?level-width:null;
 if(confirmed)checks.check('plan',positive(width)&&positive(targetPrice)&&price>targetPrice,'SHORT_TARGET_ALREADY_REACHED');
 const anchor=i=>history[Math.round(i/STEP)-1].openTime;
 const patternId=confirmed?['short',anchor(channel.anchorStart),anchor(channel.anchorEnd),channel.side].join(':'):null;
 if(confirmed)checks.check('unused',!used.includes(patternId),'SHORT_PATTERN_ALREADY_USED');
 const consolidation=confirmed?channelConsolidation({history,channel,side:'SHORT',price,signalTime:signal.openTime}):null;
 if(consolidation){
  checks.check('range',consolidation.passed||consolidation.reason==='WAIT_CHANNEL_CONSOLIDATION_BREAK',consolidation.reason);
  if(positive(consolidation.low))checks.check('rangeBreak',price<consolidation.low,'WAIT_CHANNEL_CONSOLIDATION_BREAK');
 }
 if(!checks.complete)return {...no(checks.failure||'SHORT_PRICE_INVALIDATED'),...(consolidation?{consolidation}:{})};
 return {ready:true,reason:'SHORT_CHANNEL_READY',conditions:checks.report(),setup:{consolidation,version:FUTURES_SHORT_POLICY.version,entryPolicyVersion:FUTURES_SHORT_POLICY.entryPolicyVersion,period:FUTURES_SHORT_POLICY.period,livePriceRule:FUTURES_SHORT_POLICY.livePriceRule,patternId,signalTime:signal.openTime,expiresAt:signal.closeTime,level,liveLevel,regressionCenter:liveCenter,regressionSlope:regression.slope,width,targetPrice,volumeRatio,meanDollarVolume,lowTouches:channel.lowTouches,highTouches:channel.highTouches}};
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
