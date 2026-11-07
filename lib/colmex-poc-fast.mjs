import {createColmexAudit} from './colmex-ma-audit.mjs';
import {PocFastWatch,POC_FAST_WATCH_POLICY} from './poc-fast-watch.mjs';
import {AUTO_POLICY,configuredLive,brokerBars,contiguousHistory,num} from './colmex-auto-policy.mjs';
import {channelEntryConfig} from './channel-primary-entry.mjs';
import {colmexChannelSignal} from './colmex-channel-entry.mjs';
import {colmexChannelLiveBar} from './channel-live-bar.mjs';
import {hasBlockingPending} from './colmex-live-state.mjs';
import {regularSession} from './colmex-market-hours.mjs';
import {runCycle} from './colmex-auto-runner.mjs';
const blocked=s=>s.halt||hasBlockingPending(s)||s.positions.length>=AUTO_POLICY.maxPositions;
export function colmexFastCandidates(state,env,now=Date.now()){
 if(!state||!configuredLive(env)||!channelEntryConfig(env,'COLMEX').enabled||!regularSession(now)||blocked(state))return [];
 const watch=new PocFastWatch(state.pocFastWatch,()=>now);
 // Seed from recorded four-condition scans after an upgrade/restart.
 if(!state.pocFastWatch)for(const [symbol,check]of Object.entries(state.checks||{}))watch.observe(symbol,check.entryDecisions?.channel,now);
 state.pocFastWatch=watch.state;
 return watch.list(AUTO_POLICY.symbols.filter(s=>!state.positions.some(p=>p.symbol===s)),now);
}
export async function runColmexFastPoll(args){
 const {state,env,broker,save,now=Date.now,deadline=now()+24000}=args;
 if(!colmexFastCandidates(state,env,now()).length)return {reason:'NO_FAST_CANDIDATES'};
 const watch=new PocFastWatch(state.pocFastWatch,now),symbol=watch.take(AUTO_POLICY.symbols.filter(s=>!state.positions.some(p=>p.symbol===s)));
 if(!symbol)return {reason:'FAST_COOLDOWN'};
 state.pocFastWatch=watch.state;await save(state);
 // A candidate is only a hint. Fetch authoritative bars and a current quote.
 const instruments=await broker.instruments(env.COLMEX_AUTO_ACCOUNT_ID),matches=instruments.filter(i=>i.name===symbol&&['EQUITY','ETF'].includes(i.type));
 if(matches.length!==1){watch.remove(symbol);await save(state);return {reason:'INSTRUMENT_UNAVAILABLE_OR_AMBIGUOUS'};}
 const id=matches[0].tradableInstrumentId;if(!/^\d+$/.test(String(id)))throw Error('INSTRUMENT_SCHEMA');
 const history=await broker.history(id,env.COLMEX_AUTO_ACCOUNT_ID),historyAt=now();
 const quote=await broker.quote(id,env.COLMEX_AUTO_ACCOUNT_ID),at=now();
 const result=colmexChannelSignal({symbol,bars:contiguousHistory(brokerBars(history,at)).bars,price:num(quote.bp),ask:num(quote.ap),priceAsOf:at,now:at,entryAfter:Math.max(state.createdAt,state.after[symbol]||0,channelEntryConfig(env,'COLMEX').enabledAfter||0),used:state.used,liveBar:colmexChannelLiveBar(history,at,historyAt),settings:state.settings||{}},channelEntryConfig(env,'COLMEX'));
 watch.observe(symbol,result,at);watch.state.lastCheckedAt=at;watch.state.lastResult=result.reason;
 state.checks[symbol]={at,reason:result.reason,technicalReady:result.ready,entryDecisions:{primary:'channel_long_short',channel:{ready:result.ready,reason:result.reason,side:result.side||null,directions:result.directions,conditionReports:result.conditionReports},selected:result.ready?result.setup.entryMode:null}};
 state.scanActivity={at,symbol,mode:'POC_FAST_WATCH',dataAvailable:true,entryBlockReason:null};await save(state);
 if(!result.ready)return {reason:result.reason};
 if(now()>deadline-16000){watch.state.lastResult='FAST_ENTRY_DEADLINE';state.checks[symbol].entryBlockReason='FAST_ENTRY_DEADLINE';await save(state);return {reason:'FAST_ENTRY_DEADLINE'};}
 // Same account reconciliation, durable intent, protection and final policy guards.
 const executed=await runCycle({...args,fastSymbol:symbol});watch.state.lastResult=executed.reason;await save(state);return executed;
}
export async function runColmexFastWorker({env,until,acquire,brokerFactory,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),onError=()=>{},flushAudit=async()=>{}}){
 let polls=0;
 while(configuredLive(env)&&regularSession(now())&&now()<until-17000&&polls<28){
  const lock=await acquire();
  if(lock){try{
   if(!colmexFastCandidates(lock.state,env,now()).length)break;
   const deadline=Math.min(until,now()+26000),broker=brokerFactory(deadline),audit=createColmexAudit(lock.state,{},now);
   // Discovery and position management must not be starved by the fast lane.
   if(!lock.state.lastCycleAt||now()-lock.state.lastCycleAt>=55000){
    const result=await runCycle({state:lock.state,save:lock.save,broker,env,now,deadline,audit});
    lock.state.lastResult=result.reason;lock.state.lastCompletedAt=now();lock.state.lastError=null;
   }else await runColmexFastPoll({state:lock.state,save:lock.save,broker,env,now,deadline,audit});
   if(now()<deadline-1500)await flushAudit(lock.state);
   await lock.save(lock.state);
   polls++;
  }catch(error){if(error.statePersistenceFailure)throw error;lock.state.pocFastWatch.lastResult='FAST_WATCH_READ_FAILED';await lock.save(lock.state);onError(error);break;}finally{await lock.release();}}
  await sleep(POC_FAST_WATCH_POLICY.intervalMs);
 }
 return {polls};
}
