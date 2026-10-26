// Shared, causal OHLC strategy (daily by default; Binance selects 5m). Extremes include wicks; pivots require a subsequent closed bar.
export const WYCKOFF_RULES = Object.freeze({timeframe:'1d', minConsolidationBars:3, targetMultiplier:1.07, stopLossPct:6});
export function validateDailyBars(rows, {now=Date.now(),timeframe='1d',isSessionGap=null}={}) {
  if(!['1d','5m'].includes(timeframe))throw Error('UNSUPPORTED_WYCKOFF_TIMEFRAME');
  const intraday=timeframe==='5m';
  if(!Array.isArray(rows)||rows.length<3)throw Error('WAIT_DAILY_BARS');
  let previous=-Infinity;
  return rows.map(r=>{
    if(r.closed===false)throw Error('UNFINISHED_DAILY_BAR');
    const close=Number(r.close),high=Number(r.high),low=Number(r.low);
    const time=r.closeTime!=null?Number(r.closeTime):r.date!=null?Date.parse(r.date):r.time!=null?Number(r.time)*1000:NaN;
    if(!(close>0)||!Number.isFinite(close)||!Number.isFinite(time)||time<=previous||time>now)throw Error('INVALID_DAILY_BARS');
    if(Number.isFinite(previous)&&(intraday?(time-previous!==300000&&!(typeof isSessionGap==='function'&&isSessionGap(previous,time))):time-previous<20*3600000))throw Error(intraday?'FIVE_MINUTE_TIMEFRAME_REQUIRED':'DAILY_TIMEFRAME_REQUIRED');
    if(![high,low].every(v=>Number.isFinite(v)&&v>0)||high<close||low>close||high<low)throw Error('DAILY_HIGH_LOW_REQUIRED');
    if(r.open!=null&&(!Number.isFinite(Number(r.open))||Number(r.open)<low||Number(r.open)>high))throw Error('INVALID_DAILY_OHLC');
    if(r.date!=null&&(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||new Date(time).toISOString().slice(0,10)!==r.date||Date.parse(r.date)+86400000>now))throw Error('UNFINISHED_DAILY_BAR');
    if(r.timeframe!=null&&!(intraday?r.timeframe==='5m':['1d','D1'].includes(r.timeframe)))throw Error(intraday?'FIVE_MINUTE_TIMEFRAME_REQUIRED':'DAILY_TIMEFRAME_REQUIRED');
    if(intraday&&r.closeTime==null)throw Error('FIVE_MINUTE_CLOSE_TIME_REQUIRED');
    previous=time;return {close,high,low,time};
  });
}
export function evaluateWyckoff(rows,{minConsolidationBars=3,now=Date.now(),timeframe='1d',minGreenBeforePeak=timeframe==='5m'?2:0,isSessionGap=null,rollingSearch=false,after=0,diagnostics=false}={}){
  if(!Number.isInteger(minGreenBeforePeak)||minGreenBeforePeak<0)throw Error('INVALID_GREEN_PEAK_COUNT');
  if(!Number.isInteger(minConsolidationBars)||minConsolidationBars<3)throw Error('INVALID_CONSOLIDATION_COUNT');
  const bars=validateDailyBars(rows,{now,timeframe,isSessionGap});
  // Only candles strictly before the candidate peak qualify; doji and missing opens are not green.
  const eligiblePeak=i=>(!rollingSearch||bars[i].time>after)&&i>=minGreenBeforePeak&&Array.from({length:minGreenBeforePeak},(_,k)=>rows[i-1-k]).every(b=>Number.isFinite(Number(b.open))&&Number(b.close)>Number(b.open));
  let state={phase:'SEARCH_PEAK'},buy=null,searchPeak=null,lastReset=null;
  const recordReset=(reason,i)=>{if(diagnostics&&state.initialPeak)lastReset={reason,at:bars[i].time,fromPhase:state.phase,initialPeak:{...state.initialPeak},firstLow:state.firstLow?{...state.firstLow}:null,barHigh:bars[i].high,barLow:bars[i].low};};
  const pivot=(i,field='close')=>({price:bars[i][field],time:bars[i].time,index:i});
  for(let i=1;i<bars.length;i++){
    const prev=bars[i-1].close,price=bars[i].close,bar=bars[i];
    buy=null;
    if(rollingSearch){
      // Cash-only intraday search: newer confirmed local peaks replace unfinished
      // structures. Bound an unfinished setup to 78 trading bars (one session),
      // and a Spring to three further bars; closures do not count as bars.
      const expired=state.initialPeak&&(i-state.initialPeak.index>=78||
        state.springStartedIndex!=null&&i-state.springStartedIndex>3);
      if(expired){recordReset(state.springStartedIndex!=null&&i-state.springStartedIndex>3?'SPRING_EXPIRED':'SETUP_EXPIRED',i);state={phase:'SEARCH_PEAK'};searchPeak=null;}
      if(bars[i-1].time>after&&eligiblePeak(i-1)&&price<prev&&bar.high<bars[i-1].high&&
         (!state.initialPeak||bars[i-1].time>state.initialPeak.time)){
        recordReset('NEWER_PEAK',i);
        state={phase:'FIRST_LOW',initialPeak:pivot(i-1,'high'),lowCandidate:pivot(i,'low')};
        searchPeak=state.initialPeak;continue;
      }
    }
    if(state.phase==='SIGNALLED'){
      // Keep the original confirmation through three additional closed 5m bars.
      if(timeframe==='5m' && i<=state.confirmation.index+3 &&
         bar.low>=state.springLow.price && bar.high<state.targetPrice){
        buy={...state};continue;
      }
      recordReset('CONFIRMATION_ENDED',i);state={phase:'SEARCH_PEAK'};searchPeak=null;
    }
    if(state.phase==='SEARCH_PEAK'){
      if(eligiblePeak(i-1)&&(!searchPeak||bars[i-1].high>searchPeak.price))searchPeak=pivot(i-1,'high');
      if(searchPeak&&price<prev&&bar.high<searchPeak.price){state={phase:'FIRST_LOW',initialPeak:searchPeak,lowCandidate:pivot(i,'low')};}
      else if(eligiblePeak(i)&&(!searchPeak||bar.high>searchPeak.price))searchPeak=pivot(i,'high');
      continue;
    }
    if(bar.high>=state.initialPeak.price){recordReset('INITIAL_PEAK_REACHED',i);state={phase:'SEARCH_PEAK'};searchPeak=eligiblePeak(i)?pivot(i,'high'):null;continue;}
    if(state.phase==='FIRST_LOW'){
      if(bar.low<state.lowCandidate.price){state.lowCandidate=pivot(i,'low');}
      else if(price>prev){state.firstLow=state.lowCandidate;state.highCandidate=pivot(i,'high');state.phase='RALLY_HIGH';}
    }else if(state.phase==='RALLY_HIGH'){
      if(bar.low<state.firstLow.price){recordReset(state.phase==='RALLY_HIGH'?'LOW_BROKEN_BEFORE_TEST':'LOW_BROKEN_BEFORE_CONSOLIDATION',i);state={phase:'SEARCH_PEAK'};searchPeak=null;continue;}
      if(bar.high>state.highCandidate.price)state.highCandidate=pivot(i,'high');
      else if(price<prev){state.rallyHigh=state.highCandidate;state.testCandidate=pivot(i,'low');state.phase='SECONDARY_TEST';}
    }else if(state.phase==='SECONDARY_TEST'){
      if(bar.low<state.firstLow.price){recordReset(state.phase==='RALLY_HIGH'?'LOW_BROKEN_BEFORE_TEST':'LOW_BROKEN_BEFORE_CONSOLIDATION',i);state={phase:'SEARCH_PEAK'};searchPeak=null;continue;}
      if(bar.low<state.testCandidate.price)state.testCandidate=pivot(i,'low');
      else if(price>prev){state.secondaryTest=state.testCandidate;state.consolidationBars=1;state.phase='CONSOLIDATION';}
    }else if(state.phase==='CONSOLIDATION'){
      if(bar.low<state.firstLow.price){
        if(state.consolidationBars<minConsolidationBars){recordReset('LOW_BROKEN_TOO_EARLY',i);state={phase:'SEARCH_PEAK'};searchPeak=null;continue;}
        state.springLow=pivot(i,'low');state.springStartedIndex=i;state.phase='SPRING';
      }else state.consolidationBars++;
    }else if(state.phase==='SPRING'){
      if(bar.low<state.springLow.price)state.springLow=pivot(i,'low');
      if(state.springLow.index<i&&price>state.firstLow.price){
        state.phase='SIGNALLED';
        state.patternId=(timeframe==='5m'?'5m:':'')+String(state.initialPeak.time)+':'+String(state.springLow.time);
        state.signalTime=bars[i].time;
        state.confirmation={price,time:bars[i].time,index:i};
        state.targetPrice=state.initialPeak.price*WYCKOFF_RULES.targetMultiplier;
        buy={...state};
      }
    }
  }
  return {...state,...(diagnostics?{searchReset:lastReset,searchCandidate:state.phase==='SEARCH_PEAK'&&searchPeak?{...searchPeak}:null}:{}),minGreenBeforePeak,price:bars.at(-1).close,time:bars.at(-1).time,timeframe,buyConfirmed:!!buy,sellConfirmed:false,
    direction:bars.at(-1).close>bars.at(-2).close?'UP':bars.at(-1).close<bars.at(-2).close?'DOWN':'SIDEWAYS'};
}
export function createWyckoffTrade(strategy,entryPrice,{stopLossPct=WYCKOFF_RULES.stopLossPct}={}){
  if(!strategy?.buyConfirmed||!['1d','5m'].includes(strategy.timeframe))throw Error('WYCKOFF_ENTRY_NOT_CONFIRMED');
  if(!Number.isFinite(stopLossPct)||stopLossPct<=0||stopLossPct>=100)throw Error('STOP_LOSS_NOT_CONFIGURED');
  const initialPeak=Number(strategy.initialPeak?.price),targetPrice=initialPeak*1.07;
  if(!Number.isFinite(entryPrice)||entryPrice<=0||!Number.isFinite(targetPrice)||targetPrice<=entryPrice)throw Error('ENTRY_AT_OR_ABOVE_TARGET');
  if(!strategy.patternId)throw Error('INVALID_PATTERN_ID');
  return {strategyId:strategy.timeframe==='5m'?'WYCKOFF_5M_V1':'WYCKOFF_D1_V1',timeframe:strategy.timeframe,patternId:strategy.patternId,initialPeak,targetPrice,
    setup:{initialPeak:strategy.initialPeak,firstLow:strategy.firstLow,rallyHigh:strategy.rallyHigh,secondaryTest:strategy.secondaryTest,springLow:strategy.springLow,confirmation:strategy.confirmation,signalTime:strategy.signalTime,patternId:strategy.patternId},
    firstLow:strategy.firstLow.price,springLow:strategy.springLow.price,stopLossPct,stopPrice:entryPrice*(1-stopLossPct/100)};
}
export function wyckoffExit(position,price){
  if(!['WYCKOFF_D1_V1','WYCKOFF_5M_V1'].includes(position?.strategyId))return {sell:false,reason:'LEGACY_POSITION_REQUIRES_REVIEW'};
  if(![price,position.initialPeak,position.targetPrice,position.stopPrice].every(v=>Number.isFinite(v)&&v>0)||Math.abs(position.targetPrice-position.initialPeak*1.07)>position.targetPrice*1e-10)throw Error('INVALID_WYCKOFF_POSITION');
  if(price<=position.stopPrice)return {sell:true,reason:'WYCKOFF_STOP_LOSS'};
  if(price>=position.targetPrice)return {sell:true,reason:'WYCKOFF_TARGET_7_ABOVE_INITIAL_PEAK'};
  return {sell:false,reason:'WYCKOFF_HOLD'};
}
