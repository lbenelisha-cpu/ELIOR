import {WYCKOFF_RULES} from './wyckoff-strategy.mjs';

// Remember the first live confirmation, rather than refreshing its expiry on every scan.
// A saved decision can restore the same timestamp after a server restart.
export function createLiveConfirmationTracker(){
  const signals=new Map();
  return function liveConfirmation(setup,{symbol,price,priceAsOf,now,priorLiveConfirmation=null}){
    if(setup.timeframe!=='5m'||(!setup.buyConfirmed&&setup.phase!=='SPRING'))return setup;
    const patternId=setup.patternId||'5m:'+setup.initialPeak.time+':'+setup.springLow.time;
    const prior=signals.get(symbol)?.patternId===patternId?signals.get(symbol):priorLiveConfirmation;
    let saved=prior?.patternId===patternId&&prior.confirmation?.live===true&&
      Number.isFinite(prior.signalTime)&&prior.signalTime<=now?prior:null;
    if(setup.buyConfirmed&&(!saved||setup.signalTime<=saved.signalTime))return setup;
    const targetPrice=setup.initialPeak.price*WYCKOFF_RULES.targetMultiplier;
    if(!saved){
      const tickTime=Date.parse(priceAsOf);
      if(now<setup.time||now-setup.time>300000||!(tickTime>setup.time)||
         !(price>setup.firstLow.price)||!(price<targetPrice))return setup;
      const signalTime=Math.min(now,tickTime);
      saved={signalTime,confirmation:{price,time:signalTime,index:null,live:true}};
    }
    const confirmed={...setup,phase:'SIGNALLED',buyConfirmed:true,patternId,
      signalTime:saved.signalTime,confirmation:saved.confirmation,targetPrice,
      signalInvalidated:saved.signalInvalidated===true||price<setup.springLow.price||price>=targetPrice};
    signals.set(symbol,confirmed);
    return confirmed;
  };
}
export const withLiveConfirmation=createLiveConfirmationTracker();
