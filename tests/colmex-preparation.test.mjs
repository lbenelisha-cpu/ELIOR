import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzePreparation,runPreparationCycle,PREPARATION_VERSION} from '../lib/colmex-preparation.mjs';
import {initialState,runCycle} from '../lib/colmex-auto-runner.mjs';
import {AUTO_POLICY,LIVE_ACK} from '../lib/colmex-auto-policy.mjs';
import {makeHandler} from '../netlify/functions/colmex-auto-status.mjs';
const closed=Date.parse('2026-10-23T20:00:00Z'),now=Date.parse('2026-10-24T18:00:00Z'),step=300000;
function history(){
 const prices=[...Array(16).fill(95),95,97,100,90,80,85,92,87,82,84,86,85,86,50];
 return {barDetails:prices.map((c,i)=>({t:closed-(prices.length-i)*step,o:i===16||i===17?c-1:c,h:c,l:i===16||i===17?c-1:c,c,v:100}))};
}
test('closed-market Spring uses actual session/RSI and reports its lower-second-recovery blocker',()=>{
 const h=history(),r=analyzePreparation(h,{symbol:'AAPL',now});
 assert.equal(r.phase,'SPRING');assert.ok(r.rsi<=30);assert.equal(r.dataAt,closed);assert.equal(r.checkedAt,now);assert.equal(r.candidate,false);assert.equal(r.reason,'SECOND_RECOVERY_NOT_HIGHER');assert.equal(r.executionReady,false);assert.equal(r.closedOnly,true);
 // A weekend quote/open bar must not change the last valid market close.
 h.barDetails.push({t:now,o:5,h:6,l:4,c:5});assert.deepEqual(analyzePreparation(h,{symbol:'AAPL',now}),r);
 const old=history();old.barDetails=old.barDetails.map(b=>({...b,t:b.t-86400000}));
 const stale=analyzePreparation(old,{symbol:'AAPL',now});assert.equal(stale.candidate,false);assert.equal(stale.reason,'INCOMPLETE_LAST_SESSION');
});
test('already-used patterns and missing history cannot become preparation candidates',()=>{
 const h=history(),r=analyzePreparation(h,{symbol:'AAPL',now});
 const peakTime=h.barDetails[18].t+step;
 const used=analyzePreparation(h,{symbol:'AAPL',now,used:['5m:'+peakTime+':SPRING_RSI:old']});
 assert.equal(used.candidate,false);assert.equal(used.reused,true);
 assert.throws(()=>analyzePreparation({barDetails:[]},{symbol:'AAPL',now}),/WAIT_RSI_DATA/);
 assert.equal(analyzePreparation(h,{symbol:'AAPL',now,after:closed}).candidate,false);
});
test('closed-market rotation covers all fifty even after one failure and throttles successful histories',async()=>{
 const state=initialState(now),catalog=AUTO_POLICY.symbols.map((name,i)=>({name,type:'EQUITY',tradableInstrumentId:i+1}));
 let t=now,calls=0,saves=0,catalogCalls=0;
 const broker={instruments:async()=>{catalogCalls++;return catalog;},history:async id=>{calls++;if(id===1)throw Error('private broker error');return history();},quote(){throw Error('no quote allowed');},write(){throw Error('no order allowed');}};
 for(let i=0;i<10;i++,t+=60000)await runPreparationCycle({state,broker,save:async()=>saves++,account:'123',now:()=>t});
 assert.equal(state.preparation.checked,50);assert.equal(calls,50);assert.equal(saves,50);assert.equal(catalogCalls,10);
 assert.equal(state.preparation.rows.AAPL.error,'PREPARATION_DATA_UNAVAILABLE');assert.equal(state.preparation.candidates.length,0);
 assert.deepEqual(state.used,[]);assert.deepEqual(state.positions,[]);assert.equal(state.pending,null);
 const r=await runPreparationCycle({state,broker,save:async()=>{},account:'123',now:()=>Date.parse('2026-10-26T15:00:00Z')});
 assert.equal(r.reason,'PREPARATION_MARKET_OPEN');assert.equal(calls,50);
 // Retry the failed stock once; successful stocks stay cached until their 30-minute interval.
 await runPreparationCycle({state,broker,save:async()=>{},account:'123',now:()=>t});assert.equal(calls,51);
 await runPreparationCycle({state,broker,save:async()=>{},account:'123',now:()=>t+60000});assert.equal(calls,51);
});
test('real closed-session cycle scans with a full portfolio, without consuming signals or writing orders',async()=>{
 const s=initialState(now),env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123'};
 const snap={positions:[],orders:[{side:'buy'},{side:'buy'},{side:'buy'}],history:[],account:{},state:{availableCash:0}};
 const broker={snapshot:async()=>snap,instruments:async()=>[{name:'AAPL',tradableInstrumentId:1,type:'EQUITY'}],history:async()=>history(),quote(){throw Error('unexpected quote');},write(){throw Error('unexpected order');}};
 const r=await runCycle({state:s,broker,env,save:async()=>{},now:()=>now});assert.equal(r.reason,'OUTSIDE_REGULAR_SESSION');assert.equal(s.preparation.rows.AAPL.candidate,false);assert.deepEqual(s.used,[]);assert.equal(s.pending,null);
 const h=makeHandler({env,storeFactory:()=>({get:async()=>({state:s})})});const d=JSON.parse((await h({httpMethod:'GET'})).body);assert.equal(d.preparation.rows.AAPL.executionReady,false);assert.deepEqual(d.checks,{});
});

test('complete close is reused for six hours, a new close invalidates immediately',async()=>{
 const state=initialState(now);state.preparation={version:PREPARATION_VERSION,rows:Object.fromEntries(AUTO_POLICY.symbols.map(symbol=>[symbol,analyzePreparation(history(),{symbol,now})]))};
 let reads=0;const broker={instruments:async()=>{reads++;return [];}};
 await runPreparationCycle({state,broker,account:'123',save:async()=>{},now:()=>now+35*60000});assert.equal(reads,0);
 await runPreparationCycle({state,broker,account:'123',save:async()=>{},now:()=>now+6*3600000});assert.equal(reads,1);
 const fresh=initialState(now);fresh.preparation={version:PREPARATION_VERSION,rows:Object.fromEntries(AUTO_POLICY.symbols.map(symbol=>[symbol,{...analyzePreparation(history(),{symbol,now}),checkedAt:Date.parse('2026-10-26T19:59:00Z')}]))};
 await runPreparationCycle({state:fresh,broker,account:'123',save:async()=>{},now:()=>Date.parse('2026-10-26T20:01:00Z')});assert.equal(reads,2);
});
test('closed empty snapshot cache expires, and pending work or market opening bypasses it',async()=>{
 const env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123'};
 let t=now,reads=0;const broker={snapshot:async()=>{reads++;return {positions:[],orders:[],history:[],account:{},state:{}};},instruments:async()=>[],write:()=>assert.fail('no order')};
 const s=initialState(now),run=()=>runCycle({state:s,broker,env,save:async()=>{},now:()=>t});
 await run();assert.equal(reads,1);t+=60000;await run();assert.equal(reads,1);t=now+5*60000;await run();assert.equal(reads,2);
 t+=60000;s.pending={kind:'STOP',positionId:'unknown',at:t,stopLoss:10};await run();assert.equal(reads,3);
 s.pending=null;s.closedEmptySnapshotAt=Date.parse('2026-10-26T13:29:00Z');s.lastCycleAt=null;t=Date.parse('2026-10-26T13:30:00Z');await run();assert.equal(reads,4);
});
test('broker orders and known positions never qualify for empty account caching',async()=>{
 const env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123'};
 let reads=0,t=now;const s=initialState(now),broker={snapshot:async()=>{reads++;return {positions:[],orders:[{side:'buy'}],history:[],account:{},state:{}};},instruments:async()=>[]};
 await runCycle({state:s,broker,env,save:async()=>{},now:()=>t});t+=60000;await runCycle({state:s,broker,env,save:async()=>{},now:()=>t});assert.equal(reads,2);assert.equal(s.closedEmptySnapshotAt,null);
});

test('preparation retains RSI between 30 and 40 but does not call an unconfirmed Spring a candidate',()=>{
 const h=history();Object.assign(h.barDetails.at(-1),{o:86,h:86,l:50,c:80});
 const ready=analyzePreparation(h,{symbol:'AAPL',now});assert.ok(ready.rsi>30&&ready.rsi<40);assert.equal(ready.candidate,false);assert.equal(ready.reason,'SECOND_RECOVERY_NOT_HIGHER');assert.equal(ready.executionReady,false);
 h.barDetails.at(-1).c=85;const high=analyzePreparation(h,{symbol:'AAPL',now});assert.equal(high.reason,'SECOND_RECOVERY_NOT_HIGHER');assert.equal(high.candidate,false);
});
