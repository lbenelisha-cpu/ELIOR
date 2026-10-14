import {evaluateWyckoff,createWyckoffTrade,wyckoffExit} from './wyckoff-strategy.mjs';
import {SPRING_EXIT_POLICY} from './binance-position-exit.mjs';
const cancelledSignals=new Map();
const pendingSpringSignals=new Map();
export function assertSpringEntryReady(trade,price,now=Date.now()){
  if(trade?.exitPolicy!==SPRING_EXIT_POLICY)return;
  if(!(Number(trade.springEntryPrice)>0)||!(price>0))throw Error('INVALID_SPRING_ENTRY');
  if(!(now>Number(trade.setup?.signalTime))||!(now<Number(trade.springSignalExpiresAt)))throw Error('STALE_5M_SIGNAL');
  if(price>Number(trade.springEntryPrice))throw Error('WAIT_SPRING_RETEST');
}
export function evaluateDailyTrade({symbol,bars,price,priceAsOf,position=null,usedPatternIds=[],now=Date.now(),timeframe='1d',exitEvaluator=wyckoffExit,entryMode='reclaim'}){
  if(!Number.isFinite(price)||price<=0)throw Error('INVALID_LIVE_PRICE');
  const age=now-Date.parse(priceAsOf);
  if(!Number.isFinite(age)||age< -5000||age>90000)throw Error('WAIT_FRESH_PRICE');
  // Exits use the saved trade, independently of the historical data provider.
  if(position){
    const exit=exitEvaluator(position,price);
    return {ok:true,symbol,position:'LONG',entryConfirmed:false,entryEligible:false,entryStage:null,orderFraction:null,
      buyQualified:false,buyReason:exit.reason,rawDecision:exit.sell?'SELL':'HOLD',score:0,priceAsOf,at:new Date(now).toISOString(),
      strategy:{...position,price,livePrice:price,timeframe:position.timeframe||'1d',buyConfirmed:false,sellConfirmed:exit.sell,exitReason:exit.sell?exit.reason:null},
      entryBasePrice:position.firstLow,entryTargetPrice:position.targetPrice,wyckoffTrade:position};
  }
  const setup=evaluateWyckoff(bars,{now,timeframe});
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
     (price<setup.springLow.price||price>=setup.targetPrice))cancelledSignals.set(signalKey,expiresAt);
  const cancelled=timeframe==='5m'&&cancelledSignals.has(signalKey);
  const signalValid=timeframe!=='5m'||now<expiresAt;
  // Five-minute entries require the latest closed bar; daily callers keep their existing window.
  const fresh=signalAge>=0&&signalAge<=(timeframe==='5m'?300000:4*86400000);
  const confirmed=setup.buyConfirmed&&fresh&&signalValid&&!cancelled&&price>setup.firstLow.price&&price<setup.targetPrice&&!usedPatternIds.includes(setup.patternId);
  const trade=confirmed?createWyckoffTrade(setup,price):null;
  return {ok:true,symbol,position:'CASH',entryConfirmed:confirmed,entryEligible:confirmed,entryStage:confirmed?1:null,
    orderFraction:confirmed?1:null,buyQualified:confirmed,buyReason:confirmed?'WYCKOFF_RECLAIM':cancelled?'WYCKOFF_SIGNAL_INVALIDATED':!signalValid&&setup.buyConfirmed?'STALE_5M_SIGNAL':!fresh?(timeframe==='5m'?'STALE_5M_SIGNAL':'STALE_DAILY_SIGNAL'):usedPatternIds.includes(setup.patternId)?'PATTERN_ALREADY_USED':setup.phase,
    rawDecision:confirmed?'BUY':'HOLD',score:confirmed?100:0,priceAsOf,at:new Date(now).toISOString(),
    strategy:{...setup,price,livePrice:price,buyConfirmed:confirmed,wyckoff:setup},
    entryBasePrice:setup.firstLow?.price??null,entryTargetPrice:setup.targetPrice??null,wyckoffTrade:trade};
}
