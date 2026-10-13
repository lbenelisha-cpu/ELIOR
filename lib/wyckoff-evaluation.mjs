import {evaluateWyckoff,createWyckoffTrade,wyckoffExit} from './wyckoff-strategy.mjs';
const cancelledSignals=new Map();
export function evaluateDailyTrade({symbol,bars,price,priceAsOf,position=null,usedPatternIds=[],now=Date.now(),timeframe='1d',exitEvaluator=wyckoffExit}){
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
