import {evaluateWyckoff,createWyckoffTrade,wyckoffExit} from './wyckoff-strategy.mjs';
export function evaluateDailyTrade({symbol,bars,price,priceAsOf,position=null,usedPatternIds=[],now=Date.now()}){
  if(!Number.isFinite(price)||price<=0)throw Error('INVALID_LIVE_PRICE');
  const age=now-Date.parse(priceAsOf);
  if(!Number.isFinite(age)||age< -5000||age>90000)throw Error('WAIT_FRESH_PRICE');
  // Exits use the saved trade, independently of the historical data provider.
  if(position){
    const exit=wyckoffExit(position,price);
    return {ok:true,symbol,position:'LONG',entryConfirmed:false,entryEligible:false,entryStage:null,orderFraction:null,
      buyQualified:false,buyReason:exit.reason,rawDecision:exit.sell?'SELL':'HOLD',score:0,priceAsOf,at:new Date(now).toISOString(),
      strategy:{...position,price,livePrice:price,timeframe:'1d',buyConfirmed:false,sellConfirmed:exit.sell,exitReason:exit.sell?exit.reason:null},
      entryBasePrice:position.firstLow,entryTargetPrice:position.targetPrice,wyckoffTrade:position};
  }
  const setup=evaluateWyckoff(bars,{now});
  const signalAge=now-setup.time;
  // Latest signal must be from the last completed daily session (weekends allowed).
  const fresh=signalAge<=4*86400000;
  const confirmed=setup.buyConfirmed&&fresh&&price>setup.firstLow.price&&price<setup.targetPrice&&!usedPatternIds.includes(setup.patternId);
  const trade=confirmed?createWyckoffTrade(setup,price):null;
  return {ok:true,symbol,position:'CASH',entryConfirmed:confirmed,entryEligible:confirmed,entryStage:confirmed?1:null,
    orderFraction:confirmed?1:null,buyQualified:confirmed,buyReason:confirmed?'WYCKOFF_RECLAIM':!fresh?'STALE_DAILY_SIGNAL':usedPatternIds.includes(setup.patternId)?'PATTERN_ALREADY_USED':setup.phase,
    rawDecision:confirmed?'BUY':'HOLD',score:confirmed?100:0,priceAsOf,at:new Date(now).toISOString(),
    strategy:{...setup,price,livePrice:price,buyConfirmed:confirmed,wyckoff:setup},
    entryBasePrice:setup.firstLow?.price??null,entryTargetPrice:setup.targetPrice??null,wyckoffTrade:trade};
}
