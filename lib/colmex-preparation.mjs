import {AUTO_POLICY,brokerBars,contiguousHistory} from './colmex-auto-policy.mjs';
import {evaluateWyckoff} from './wyckoff-strategy.mjs';
import {rsiSnapshot} from './rsi-screener.mjs';
import {regularSession,stockSessionGap} from './colmex-market-hours.mjs';
import {equitySession} from './colmex-market-hours.mjs';
export const PREPARATION_VERSION='CLOSED_MARKET_WYCKOFF_RSI40_V2';
const REFRESH_MS=6*60*60000;
function lastSessionClose(now){
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 for(let i=0;i<10;i++){
  const date=new Date(Date.parse(day+'T12:00:00Z')-i*86400000).toISOString().slice(0,10),s=equitySession(date);
  if(s.known&&!s.closed&&s.closeAt<=now)return s.closeAt;
 }
 return null;
}
// Closed candles only. This output is never an entry signal or an order plan.
export function analyzePreparation(history,{symbol,now=Date.now(),after=0,used=[]}={}){
 const continuous=contiguousHistory(brokerBars(history,now)),bars=continuous.bars;
 if(bars.length<15)throw Error('WAIT_RSI_DATA');
 const setup=evaluateWyckoff(bars,{now,timeframe:'5m',isSessionGap:stockSessionGap,rollingSearch:true,after});
 const rsi=rsiSnapshot(bars),patternPrefix=setup.initialPeak?'5m:'+setup.initialPeak.time+':':null;
 const reused=!!patternPrefix&&used.some(id=>String(id).startsWith(patternPrefix));
 const expectedClose=lastSessionClose(now),complete=expectedClose!==null&&bars.at(-1).closeTime>=expectedClose;
 const spring=setup.phase==='SPRING',rsiInRange=rsi.value!==null&&rsi.value>=0&&rsi.value<=AUTO_POLICY.entryRsi.max;
 return {symbol,checkedAt:now,dataAt:bars.at(-1).closeTime,price:bars.at(-1).close,phase:setup.phase,rsi:rsi.value,
  spring,rsiInRange,reused,complete,expectedClose,candidate:complete&&spring&&rsiInRange&&!reused,executionReady:false,
  reason:!complete?'INCOMPLETE_LAST_SESSION':reused?'PATTERN_ALREADY_USED':spring?(rsiInRange?'PREPARATION_CANDIDATE':'WAIT_RSI_0_'+AUTO_POLICY.entryRsi.max):setup.phase,
  usableBars:bars.length,discardedBars:continuous.discarded,source:'Colmex Pro',timeframe:'5m',closedOnly:true};
}
export async function runPreparationCycle({state,save,broker,account,now=Date.now,deadline=now()+20000}){
 if(regularSession(now()))return {reason:'PREPARATION_MARKET_OPEN'};
 const p=state.preparation?.version===PREPARATION_VERSION?state.preparation:{version:PREPARATION_VERSION,rows:{},startedAt:now()};
 state.preparation=p;
 const expectedClose=lastSessionClose(now());
 let instruments;
 for(let scanned=0;scanned<AUTO_POLICY.scanBatchSize;scanned++){
 const symbol=AUTO_POLICY.symbols.find(s=>!p.rows[s])||AUTO_POLICY.symbols.filter(s=>(p.rows[s].error||!p.rows[s].complete?now()-p.rows[s].checkedAt>=5*60000:p.rows[s].expectedClose!==expectedClose||now()-p.rows[s].checkedAt>=REFRESH_MS)).sort((a,b)=>p.rows[a].checkedAt-p.rows[b].checkedAt)[0];
 if(!symbol)return {reason:'OUTSIDE_REGULAR_SESSION'};
 if(now()>deadline-9000)return {reason:'CYCLE_DEADLINE'};
 try{
  instruments??=await broker.instruments(account);
  if(!Array.isArray(instruments))throw Error('INSTRUMENT_SCHEMA');
  const matches=instruments.filter(i=>i.name===symbol&&['EQUITY','ETF'].includes(i.type));
  if(matches.length!==1||!/^\d+$/.test(String(matches[0].tradableInstrumentId)))throw Error('INSTRUMENT_UNAVAILABLE_OR_AMBIGUOUS');
  const history=await broker.history(matches[0].tradableInstrumentId,account);
  p.rows[symbol]=analyzePreparation(history,{symbol,now:now(),after:state.after?.[symbol]||0,used:state.used||[]});
 }catch(error){
  const allowed=['INSTRUMENT_SCHEMA','INSTRUMENT_UNAVAILABLE_OR_AMBIGUOUS','WAIT_RSI_DATA','HISTORY_SCHEMA','FIVE_MINUTE_TIMEFRAME_REQUIRED','AUTH_DENIED','ACCESS_DENIED','RATE_LIMIT','NETWORK','RESPONSE_SCHEMA','CYCLE_DEADLINE'];
  p.rows[symbol]={symbol,checkedAt:now(),candidate:false,executionReady:false,error:allowed.includes(error.code||error.message)?error.code||error.message:'PREPARATION_DATA_UNAVAILABLE'};
 }
 p.lastCheckedAt=now();p.checked=AUTO_POLICY.symbols.filter(s=>p.rows[s]).length;
 p.candidates=AUTO_POLICY.symbols.filter(s=>p.rows[s]?.candidate);
 // Persist each completed stock so a slow provider cannot discard the batch.
 await save(state);
 if(['RATE_LIMIT','AUTH_DENIED','ACCESS_DENIED','NETWORK','CYCLE_DEADLINE','INSTRUMENT_SCHEMA'].includes(p.rows[symbol].error))break;
 }
 return {reason:'OUTSIDE_REGULAR_SESSION'};
}
