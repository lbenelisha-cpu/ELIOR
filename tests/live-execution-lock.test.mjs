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
test('idle exit monitor observes price and peaks without any exchange request; triggered stop still executes',async()=>{
 const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('async function executeLiveCycle('),source.indexOf('async function getLiveAccountSnapshot('));
 let calls=0,peaks=0,stop=false,sales=0;
 const position={entryPrice:100,peakPrice:100};
 const context=vm.createContext({mode:'live',nativeProtection:{rows:{},uncertain:()=>false,release:async()=>{},sync:async()=>{}},console:{error(){}},LIVE:true,AUTO_EXECUTION:true,liveOrders:{pending:null,recover:async()=>{}},tradingPositions:()=>({BNBUSDT:position}),streams:{BNBUSDT:{lastEventAt:Date.now()}},requireLivePrice:()=>101,observePositionPeak:()=>peaks++,persistLivePeak(){},wyckoffExit:()=>({sell:stop,reason:'STOP'}),tradeControl:{paused:false},liveActionLog:[],getApiRestrictions:async()=>{calls++;return {};},liveTradingGate:()=>({ready:true}),signedBinanceGet(){},recordLiveFill(){},getLiveAccountSnapshot:async()=>({balances:[{asset:'BNB',qty:1,valueUsdt:100}]}),marketRanks:new Map(),placeLiveMarketSell:async()=>sales++});
 vm.runInContext(fn,context);const evals=[{ok:true,symbol:'BNBUSDT'}];
 await context.executeLiveCycle(evals);assert.equal(calls,0);assert.equal(peaks,1);
 stop=true;await context.executeLiveCycle(evals);assert.equal(calls,1);assert.equal(sales,1);
});
