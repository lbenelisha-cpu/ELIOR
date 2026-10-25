import {liveSpringRsi,assertLiveSpringRsi} from './wyckoff-spring-rsi.mjs';
import {evaluateWyckoff,createWyckoffTrade,wyckoffExit} from './wyckoff-strategy.mjs';
import {withLiveConfirmation} from './wyckoff-live-confirmation.mjs';
import {SPRING_EXIT_POLICY,MINIMUM_PROFIT_HOLD_MS} from './binance-position-exit.mjs';
import {FIXED_EXIT_POLICY} from './fixed-trade-exit.mjs';
import {TRAILING_EXIT_POLICY} from './trailing-profit-exit.mjs';
const cancelledSignals=new Map();
const pendingSpringSignals=new Map();
export function assertSpringEntryReady(trade,price,now=Date.now(),liveBar=null){
  if(![SPRING_EXIT_POLICY,FIXED_EXIT_POLICY,TRAILING_EXIT_POLICY].includes(trade?.exitPolicy))return;
  if(trade.entryMode==='spring_rsi_live'){assertLiveSpringRsi(trade,price,now,liveBar);return;}
  if(trade.entryMode==='wyckoff_confirmation'){
    if(!(price>0))throw Error('INVALID_LIVE_PRICE');
    if(!(trade.setup?.confirmation?.live?now>=Number(trade.setup.signalTime):now>Number(trade.setup?.signalTime))||!(now<Number(trade.signalExpiresAt)))throw Error('STALE_5M_SIGNAL');
    if(!(price>trade.firstLow)||!(price<trade.targetPrice))throw Error('WAIT_WYCKOFF_ENTRY_PRICE');
    return;
  }
  if(!(Number(trade.springEntryPrice)>0)||!(price>0))throw Error('INVALID_SPRING_ENTRY');
  if(!(now>Number(trade.setup?.signalTime))||!(now<Number(trade.springSignalExpiresAt)))throw Error('STALE_5M_SIGNAL');
  if(price>Number(trade.springEntryPrice))throw Error('WAIT_SPRING_RETEST');
}
export function evaluateDailyTrade({symbol,bars,price,priceAsOf,position=null,usedPatternIds=[],now=Date.now(),timeframe='1d',exitEvaluator=wyckoffExit,entryMode='reclaim',priorLiveConfirmation=null,liveBar=null,searchAfter=0}){
  if(!Number.isFinite(price)||price<=0)throw Error('INVALID_LIVE_PRICE');
  const age=now-Date.parse(priceAsOf);
  if(!Number.isFinite(age)||age< -5000||age>90000)throw Error('WAIT_FRESH_PRICE');
  // Exits use the saved trade, independently of the historical data provider.
  if(position){
    const exit=exitEvaluator(position,price,now);
    return {ok:true,symbol,position:'LONG',entryConfirmed:false,entryEligible:false,entryStage:null,orderFraction:null,
      buyQualified:false,buyReason:exit.reason,rawDecision:exit.sell?'SELL':'HOLD',score:0,priceAsOf,at:new Date(now).toISOString(),
      strategy:{...position,price,livePrice:price,timeframe:position.timeframe||'1d',buyConfirmed:false,sellConfirmed:exit.sell,exitReason:exit.sell?exit.reason:null},
      entryBasePrice:position.firstLow,entryTargetPrice:position.targetPrice,wyckoffTrade:position};
  }
  if(entryMode==='spring_rsi_live'&&timeframe==='5m'){
    const setup=liveSpringRsi(bars,{price,priceAsOf,now,liveBar,used:usedPatternIds,after:searchAfter,resetHighRsi:true}),confirmed=setup.buyConfirmed;
    const trade=confirmed?{...createWyckoffTrade(setup,price),exitPolicy:TRAILING_EXIT_POLICY,entryMode,
      entryRsi:setup.entryRsi,rsiCloses:setup.rsiCloses,rsiBucket:setup.rsiBucket,
      stopLossPct:1,stopPrice:price*.99,takeProfitPct:null,profitActivationPct:4,trailingGapPp:1,atrEnabled:false,profitGivebackPct:null,profitRetentionPct:null,minProfitHoldMs:0}:null;
    return {ok:true,symbol,position:'CASH',entryConfirmed:confirmed,entryEligible:confirmed,entryStage:confirmed?1:null,
      orderFraction:confirmed?1:null,buyQualified:confirmed,buyReason:setup.entryReason,rawDecision:confirmed?'BUY':'HOLD',
      score:confirmed?100:0,priceAsOf,at:new Date(now).toISOString(),strategy:{...setup,price,livePrice:price,wyckoff:setup},
      entryBasePrice:setup.springLow?.price??null,entryTargetPrice:setup.targetPrice??null,wyckoffTrade:trade};
  }
  let setup=evaluateWyckoff(bars,{now,timeframe});
  if(entryMode==='wyckoff_confirmation'&&timeframe==='5m')setup=withLiveConfirmation(setup,{symbol,price,priceAsOf,now,priorLiveConfirmation});
  for(const [key,expiry] of cancelledSignals)if(expiry<=now)cancelledSignals.delete(key);
  if(entryMode==='spring_retest'&&timeframe==='5m'){
    const fresh=now>=setup.time&&now-setup.time<=300000;
    for(const [key,s] of pendingSpringSignals)if(s.signalTime+1200000<=now)pendingSpringSignals.delete(key);
    let armed=pendingSpringSignals.get(symbol);
    if(armed&&usedPatternIds.includes(armed.patternId)){pendingSpringSignals.delete(symbol);armed=null;}
    if(fresh&&setup.buyConfirmed&&setup.signalTime<now&&setup.signalTime+1200000>now&&
       !usedPatternIds.includes(setup.patternId)&&(!armed||setup.signalTime>armed.signalTime)){
      armed={...setup};pendingSpringSignals.set(symbol,armed);
    }
    const signal=armed||setup;
    const unused=!!armed&&!usedPatternIds.includes(armed.patternId);
    const atTarget=unused&&price>=armed.targetPrice;
    if(atTarget){pendingSpringSignals.delete(symbol);cancelledSignals.set(symbol+':'+armed.patternId,armed.signalTime+1200000);}
    const cancelled=!!armed&&cancelledSignals.has(symbol+':'+armed.patternId);
    const confirmed=fresh&&unused&&!cancelled&&!atTarget&&price<=armed.springLow.price;
    const trade=confirmed?{...createWyckoffTrade(armed,price),exitPolicy:SPRING_EXIT_POLICY,
      entryMode:'spring_retest',springEntryPrice:armed.springLow.price,springSignalExpiresAt:armed.signalTime+1200000,stopLossPct:10,stopPrice:price*.9,
      atrEnabled:false,profitGivebackPct:20,profitRetentionPct:80}:null;
    const reason=confirmed?'WYCKOFF_SPRING_RETEST':!fresh?'STALE_5M_SIGNAL':atTarget||cancelled?'WYCKOFF_SIGNAL_INVALIDATED':
      unused?'WAIT_SPRING_RETEST':usedPatternIds.includes(signal.patternId)?'PATTERN_ALREADY_USED':
      signal.signalTime&&signal.signalTime+1200000<=now?'STALE_5M_SIGNAL':signal.phase;
    return {ok:true,symbol,position:'CASH',entryConfirmed:confirmed,entryEligible:confirmed,
      entryStage:confirmed?1:null,orderFraction:confirmed?1:null,buyQualified:confirmed,
      buyReason:reason,rawDecision:confirmed?'BUY':'HOLD',score:confirmed?100:0,
      priceAsOf,at:new Date(now).toISOString(),
      strategy:{...signal,price,livePrice:price,buyConfirmed:confirmed,wyckoff:signal,
        entryMode:'spring_retest',springEntryPrice:signal.springLow?.price??null,
        springSignalExpiresAt:armed?armed.signalTime+1200000:null},
      entryBasePrice:signal.springLow?.price??null,entryTargetPrice:signal.targetPrice??null,wyckoffTrade:trade};
  }
  const signalAge=now-setup.time;
  const expiresAt=Number(setup.signalTime)+4*300000;
  for(const [key,expiry] of cancelledSignals)if(expiry<=now)cancelledSignals.delete(key);
  const signalKey=symbol+':'+setup.patternId;
  if(timeframe==='5m'&&setup.buyConfirmed&&
     (setup.signalInvalidated||price<setup.springLow.price||price>=setup.targetPrice))cancelledSignals.set(signalKey,expiresAt);
  const cancelled=timeframe==='5m'&&cancelledSignals.has(signalKey);
  if(setup.confirmation?.live)setup.signalInvalidated=cancelled;
  const signalValid=timeframe!=='5m'||now<expiresAt;
  // Five-minute entries require the latest closed bar; daily callers keep their existing window.
  const fresh=signalAge>=0&&signalAge<=(timeframe==='5m'?300000:4*86400000);
  const confirmed=setup.buyConfirmed&&fresh&&signalValid&&!cancelled&&price>setup.firstLow.price&&price<setup.targetPrice&&!usedPatternIds.includes(setup.patternId);
  let trade=confirmed?createWyckoffTrade(setup,price):null;
  if(trade&&entryMode==='wyckoff_confirmation')trade={...trade,exitPolicy:SPRING_EXIT_POLICY,
    entryMode:'wyckoff_confirmation',signalExpiresAt:expiresAt,
    stopLossPct:10,stopPrice:price*.9,atrEnabled:false,profitGivebackPct:20,profitRetentionPct:80,minProfitHoldMs:MINIMUM_PROFIT_HOLD_MS};
  return {ok:true,symbol,position:'CASH',entryConfirmed:confirmed,entryEligible:confirmed,entryStage:confirmed?1:null,
    orderFraction:confirmed?1:null,buyQualified:confirmed,buyReason:confirmed?(setup.confirmation?.live?'WYCKOFF_LIVE_RECLAIM':'WYCKOFF_RECLAIM'):cancelled?'WYCKOFF_SIGNAL_INVALIDATED':!signalValid&&setup.buyConfirmed?'STALE_5M_SIGNAL':!fresh?(timeframe==='5m'?'STALE_5M_SIGNAL':'STALE_DAILY_SIGNAL'):usedPatternIds.includes(setup.patternId)?'PATTERN_ALREADY_USED':setup.phase,
    rawDecision:confirmed?'BUY':'HOLD',score:confirmed?100:0,priceAsOf,at:new Date(now).toISOString(),
    strategy:{...setup,price,livePrice:price,buyConfirmed:confirmed,wyckoff:setup},
    entryBasePrice:setup.firstLow?.price??null,entryTargetPrice:setup.targetPrice??null,wyckoffTrade:trade};
}
