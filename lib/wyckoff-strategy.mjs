// Shared, causal D1 OHLC strategy. Extremes include wicks; pivots require a subsequent closed bar.
export const WYCKOFF_RULES = Object.freeze({timeframe:'1d', minConsolidationBars:3, targetMultiplier:1.07, stopLossPct:6});
export function validateDailyBars(rows, {now=Date.now()}={}) {
  if(!Array.isArray(rows)||rows.length<3)throw Error('WAIT_DAILY_BARS');
  let previous=-Infinity;
  return rows.map(r=>{
    if(r.closed===false)throw Error('UNFINISHED_DAILY_BAR');
    const close=Number(r.close),high=Number(r.high),low=Number(r.low);
    const time=r.closeTime!=null?Number(r.closeTime):r.date!=null?Date.parse(r.date):r.time!=null?Number(r.time)*1000:NaN;
    if(!(close>0)||!Number.isFinite(close)||!Number.isFinite(time)||time<=previous||time>now)throw Error('INVALID_DAILY_BARS');
    if(Number.isFinite(previous)&&time-previous<20*3600000)throw Error('DAILY_TIMEFRAME_REQUIRED');
    if(![high,low].every(v=>Number.isFinite(v)&&v>0)||high<close||low>close||high<low)throw Error('DAILY_HIGH_LOW_REQUIRED');
    if(r.open!=null&&(!Number.isFinite(Number(r.open))||Number(r.open)<low||Number(r.open)>high))throw Error('INVALID_DAILY_OHLC');
    if(r.date!=null&&(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||new Date(time).toISOString().slice(0,10)!==r.date||Date.parse(r.date)+86400000>now))throw Error('UNFINISHED_DAILY_BAR');
    if(r.timeframe!=null&&!['1d','D1'].includes(r.timeframe))throw Error('DAILY_TIMEFRAME_REQUIRED');
    previous=time;return {close,high,low,time};
  });
}
export function evaluateWyckoff(rows,{minConsolidationBars=3,now=Date.now()}={}){
  if(!Number.isInteger(minConsolidationBars)||minConsolidationBars<3)throw Error('INVALID_CONSOLIDATION_COUNT');
  const bars=validateDailyBars(rows,{now});
  let state={phase:'SEARCH_PEAK'},buy=null,searchPeak=null;
  const pivot=(i,field='close')=>({price:bars[i][field],time:bars[i].time,index:i});
  for(let i=1;i<bars.length;i++){
    const prev=bars[i-1].close,price=bars[i].close,bar=bars[i];
    buy=null;
    if(state.phase==='SIGNALLED'){state={phase:'SEARCH_PEAK'};searchPeak=null;}
    if(state.phase==='SEARCH_PEAK'){
      if(!searchPeak||bars[i-1].high>searchPeak.price)searchPeak=pivot(i-1,'high');
      if(price<prev&&bar.high<searchPeak.price){state={phase:'FIRST_LOW',initialPeak:searchPeak,lowCandidate:pivot(i,'low')};}
      else if(bar.high>searchPeak.price)searchPeak=pivot(i,'high');
      continue;
    }
    if(bar.high>=state.initialPeak.price){state={phase:'SEARCH_PEAK'};searchPeak=pivot(i,'high');continue;}
    if(state.phase==='FIRST_LOW'){
      if(bar.low<state.lowCandidate.price){state.lowCandidate=pivot(i,'low');}
      else if(price>prev){state.firstLow=state.lowCandidate;state.highCandidate=pivot(i,'high');state.phase='RALLY_HIGH';}
    }else if(state.phase==='RALLY_HIGH'){
      if(bar.low<state.firstLow.price){state={phase:'SEARCH_PEAK'};searchPeak=null;continue;}
      if(bar.high>state.highCandidate.price)state.highCandidate=pivot(i,'high');
      else if(price<prev){state.rallyHigh=state.highCandidate;state.testCandidate=pivot(i,'low');state.phase='SECONDARY_TEST';}
    }else if(state.phase==='SECONDARY_TEST'){
      if(bar.low<state.firstLow.price||bar.high>state.rallyHigh.price){state={phase:'SEARCH_PEAK'};searchPeak=null;continue;}
      if(bar.low<state.testCandidate.price)state.testCandidate=pivot(i,'low');
      else if(price>prev){state.secondaryTest=state.testCandidate;state.consolidationBars=1;state.phase='CONSOLIDATION';}
    }else if(state.phase==='CONSOLIDATION'){
      if(bar.high>state.rallyHigh.price){state={phase:'SEARCH_PEAK'};searchPeak=null;continue;}
      if(bar.low<state.firstLow.price){
        if(state.consolidationBars<minConsolidationBars){state={phase:'SEARCH_PEAK'};searchPeak=null;continue;}
        state.springLow=pivot(i,'low');state.phase='SPRING';
      }else state.consolidationBars++;
    }else if(state.phase==='SPRING'){
      if(bar.low<state.springLow.price)state.springLow=pivot(i,'low');
      if(state.springLow.index<i&&price>state.firstLow.price){
        state.phase='SIGNALLED';
        state.patternId=String(state.initialPeak.time)+':'+String(state.springLow.time);
        state.signalTime=bars[i].time;
        state.targetPrice=state.initialPeak.price*WYCKOFF_RULES.targetMultiplier;
        buy={...state};
      }
    }
  }
  return {...state,price:bars.at(-1).close,time:bars.at(-1).time,timeframe:'1d',buyConfirmed:!!buy,sellConfirmed:false,
    direction:bars.at(-1).close>bars.at(-2).close?'UP':bars.at(-1).close<bars.at(-2).close?'DOWN':'SIDEWAYS'};
}
export function createWyckoffTrade(strategy,entryPrice,{stopLossPct=WYCKOFF_RULES.stopLossPct}={}){
  if(!strategy?.buyConfirmed||strategy.timeframe!=='1d')throw Error('WYCKOFF_ENTRY_NOT_CONFIRMED');
  if(!Number.isFinite(stopLossPct)||stopLossPct<=0||stopLossPct>=100)throw Error('STOP_LOSS_NOT_CONFIGURED');
  const initialPeak=Number(strategy.initialPeak?.price),targetPrice=initialPeak*1.07;
  if(!Number.isFinite(entryPrice)||entryPrice<=0||!Number.isFinite(targetPrice)||targetPrice<=entryPrice)throw Error('ENTRY_AT_OR_ABOVE_TARGET');
  if(!strategy.patternId)throw Error('INVALID_PATTERN_ID');
  return {strategyId:'WYCKOFF_D1_V1',patternId:strategy.patternId,initialPeak,targetPrice,
    firstLow:strategy.firstLow.price,springLow:strategy.springLow.price,stopLossPct,stopPrice:entryPrice*(1-stopLossPct/100)};
}
export function wyckoffExit(position,price){
  if(position?.strategyId!=='WYCKOFF_D1_V1')return {sell:false,reason:'LEGACY_POSITION_REQUIRES_REVIEW'};
  if(![price,position.initialPeak,position.targetPrice,position.stopPrice].every(v=>Number.isFinite(v)&&v>0)||Math.abs(position.targetPrice-position.initialPeak*1.07)>position.targetPrice*1e-10)throw Error('INVALID_WYCKOFF_POSITION');
  if(price<=position.stopPrice)return {sell:true,reason:'WYCKOFF_STOP_LOSS'};
  if(price>=position.targetPrice)return {sell:true,reason:'WYCKOFF_TARGET_7_ABOVE_INITIAL_PEAK'};
  return {sell:false,reason:'WYCKOFF_HOLD'};
}
