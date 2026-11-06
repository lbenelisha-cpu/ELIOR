import {withLiveSafety} from './helpers/live-safety.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {LiveExecutionLock} from '../lib/live-execution-lock.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('manual waits for in-flight cycle and takes precedence over automatic work',async()=>{
 const lock=new LiveExecutionLock(),gate=deferred(),manualGate=deferred(),events=[];
 const auto=lock.automatic(async()=>{events.push('auto');await gate.promise;});
 const manual=lock.manual(async()=>{events.push('manual');await manualGate.promise;});
 await lock.automatic(()=>events.push('overlap'));
 gate.resolve();await auto;await Promise.resolve();
 assert.deepEqual(events,['auto','manual']);assert.equal(lock.busy,true);
 await lock.automatic(()=>events.push('overtake'));
 manualGate.resolve();await manual;assert.equal(lock.busy,false);
});
test('waiting timeout cancels only the waiter, never releases active order or submits later',async()=>{
 const lock=new LiveExecutionLock(),gate=deferred();let submissions=0;
 const auto=lock.automatic(()=>gate.promise);
 await assert.rejects(lock.manual(()=>submissions++,5),/לא נשלחה/);
 assert.equal(lock.busy,true);await lock.automatic(()=>submissions++);
 gate.resolve();await auto;assert.equal(submissions,0);assert.equal(lock.busy,false);
});
test('multiple manual requests remain serial and failures release for the next request',async()=>{
 const lock=new LiveExecutionLock(),gate=deferred(),events=[];
 const first=lock.manual(async()=>{await gate.promise;throw Error('exchange');});
 const rejected=assert.rejects(first,/exchange/);
 const second=lock.manual(()=>events.push(2));const third=lock.manual(()=>events.push(3));
 gate.resolve();await Promise.all([rejected,second,third]);assert.deepEqual(events,[2,3]);assert.equal(lock.busy,false);
});
// The deployed source fixture was supplied from the VPS on 2026-11-06.
const deployedCycle=fs.readFileSync(new URL('./fixtures/binance-live-cycle-deployed-20261106.txt',import.meta.url),'utf8');
async function checkExitMonitor(source,{pocRequested=false}={}){
 const start=source.indexOf('async function executeLiveCycle('),end=source.indexOf('\nlet lastDisplayAccount=',start);
 assert.ok(start>=0&&end>start,'known exit-monitor source boundaries');
 const fn=source.slice(start,end),wrapped=/\bexitForLivePosition\s*\(/.test(fn);
 let calls=0,peaks=0,stop=false,sales=0,trailRefreshes=0,decisions=0,accounts=0,reconciliations=0;
 const position={entryPrice:100,peakPrice:100},reason=wrapped?'LOCAL_SETTINGS_STOP':'STOP';
 const decide=(via,saved,price)=>{
  assert.equal(via,wrapped?'wrapper':'wyckoff');assert.equal(saved,position);assert.equal(price,101);
  if(wrapped)assert.equal(trailRefreshes,decisions+1,'refresh precedes every wrapped exit decision');
  decisions++;return {sell:stop,reason};
 };
 const account=async()=>{accounts++;return {balances:[{asset:'BNB',qty:1,valueUsdt:100}]};};
 const context=vm.createContext({mode:'live',LIVE:true,AUTO_EXECUTION:true,POC_LIVE_REQUESTED:pocRequested,
  nativeProtection:{rows:{},uncertain:()=>false,release:async()=>{},sync:async()=>{}},console:{error(){}},
  liveOrders:{pending:null,recover:async()=>{}},liveManagedPositions:()=>({BNBUSDT:position}),
  streams:{BNBUSDT:{lastEventAt:Date.now()}},requireLivePrice:()=>101,observePositionPeak:()=>peaks++,persistLivePeak(){},
  // Explicit unit-test dependencies. Their real implementations and flags remain
  // outside this extracted function and are never replaced by the installer.
  refreshPocTrail:saved=>{assert.equal(saved,position);trailRefreshes++;},
  exitForLivePosition:(saved,price)=>decide('wrapper',saved,price),wyckoffExit:(saved,price)=>decide('wyckoff',saved,price),
  tradeControl:{paused:false},liveActionLog:[],getApiRestrictions:async()=>{calls++;return {};},
  liveTradingGate:()=>({ready:true}),signedBinanceGet(){},recordLiveFill(){},getLiveAccountSnapshot:account,
  reconcileLiveHoldings:async()=>{reconciliations++;return account();},marketRanks:new Map(),
  placeLiveMarketSell:async(symbol,exitReason)=>{assert.equal(symbol,'BNBUSDT');assert.equal(exitReason,reason);sales++;},
  placeLiveMarketBuy:async()=>assert.fail('exit monitor must not create a buy')});
 vm.runInContext(fn,withLiveSafety(context));const evals=[{ok:true,symbol:'BNBUSDT'}];
 await context.executeLiveCycle(evals);
 assert.equal(calls,0);assert.equal(accounts,0);assert.equal(sales,0);assert.equal(peaks,1);assert.equal(decisions,1);
 stop=true;await context.executeLiveCycle(evals);
 assert.equal(calls,1);assert.equal(sales,1);assert.equal(peaks,3);assert.equal(decisions,3);
 const pocBlocksEntries=pocRequested&&/\bPOC_LIVE_REQUESTED\b/.test(fn);
 assert.equal(reconciliations,pocBlocksEntries?0:1);assert.equal(accounts,pocBlocksEntries?2:3);
 if(wrapped)assert.equal(trailRefreshes,3);
 return {trailRefreshes,decisions,sales};
}
test('idle exit monitor observes price and peaks without any exchange request; triggered stop still executes',async()=>{
 await checkExitMonitor(fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8'));
});
test('actual deployed exit wrapper retains trailing refresh and sells with the POC entry guard on or off',async()=>{
 for(const pocRequested of [false,true]){
  assert.deepEqual(await checkExitMonitor(deployedCycle,{pocRequested}),{trailRefreshes:3,decisions:3,sales:1});
 }
});
test('an unknown dependency in the deployed exit monitor still fails validation',async()=>{
 const source=deployedCycle.replace('refreshPocTrail(saved);','unknownExitDependency(saved);');
 await assert.rejects(()=>checkExitMonitor(source),/unknownExitDependency is not defined/);
});
