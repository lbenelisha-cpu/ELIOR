import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzePreparation,runPreparationCycle} from '../lib/colmex-preparation.mjs';
import {initialState,runCycle} from '../lib/colmex-auto-runner.mjs';
import {AUTO_POLICY,LIVE_ACK} from '../lib/colmex-auto-policy.mjs';
import {makeHandler} from '../netlify/functions/colmex-auto-status.mjs';
const closed=Date.parse('2026-10-23T20:00:00Z'),now=Date.parse('2026-10-24T18:00:00Z'),step=300000;
function history(){
 const prices=[...Array(16).fill(95),95,97,100,90,80,85,92,87,82,84,86,85,86,50];
 return {barDetails:prices.map((c,i)=>({t:closed-(prices.length-i)*step,o:i===16||i===17?c-1:c,h:c,l:i===16||i===17?c-1:c,c,v:100}))};
}
test('closed-market candidate uses actual last session close and RSI, never grants executable entry',()=>{
 const h=history(),r=analyzePreparation(h,{symbol:'AAPL',now});
 assert.equal(r.phase,'SPRING');assert.ok(r.rsi<=30);assert.equal(r.dataAt,closed);assert.equal(r.checkedAt,now);assert.equal(r.candidate,true);assert.equal(r.executionReady,false);assert.equal(r.closedOnly,true);
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
test('closed-market rotation covers all ten even after one failure and throttles successful histories',async()=>{
 const state=initialState(now),catalog=AUTO_POLICY.symbols.map((name,i)=>({name,type:'EQUITY',tradableInstrumentId:i+1}));
 let t=now,calls=0,saves=0;
 const broker={instruments:async()=>catalog,history:async id=>{calls++;if(id===1)throw Error('private broker error');return history();},quote(){throw Error('no quote allowed');},write(){throw Error('no order allowed');}};
 for(let i=0;i<10;i++,t+=60000)await runPreparationCycle({state,broker,save:async()=>saves++,account:'123',now:()=>t});
 assert.equal(state.preparation.checked,10);assert.equal(calls,10);assert.equal(saves,10);
 assert.equal(state.preparation.rows.AAPL.error,'PREPARATION_DATA_UNAVAILABLE');assert.equal(state.preparation.candidates.length,9);
 assert.deepEqual(state.used,[]);assert.deepEqual(state.positions,[]);assert.equal(state.pending,null);
 const r=await runPreparationCycle({state,broker,save:async()=>{},account:'123',now:()=>Date.parse('2026-10-26T15:00:00Z')});
 assert.equal(r.reason,'PREPARATION_MARKET_OPEN');assert.equal(calls,10);
 // Retry the failed stock once; successful stocks stay cached until their 30-minute interval.
 await runPreparationCycle({state,broker,save:async()=>{},account:'123',now:()=>t});assert.equal(calls,11);
 await runPreparationCycle({state,broker,save:async()=>{},account:'123',now:()=>t+60000});assert.equal(calls,11);
});
test('real closed-session cycle scans with a full portfolio, without consuming signals or writing orders',async()=>{
 const s=initialState(now),env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123'};
 const snap={positions:[],orders:[{side:'buy'},{side:'buy'},{side:'buy'}],history:[],account:{},state:{availableCash:0}};
 const broker={snapshot:async()=>snap,instruments:async()=>[{name:'AAPL',tradableInstrumentId:1,type:'EQUITY'}],history:async()=>history(),quote(){throw Error('unexpected quote');},write(){throw Error('unexpected order');}};
 const r=await runCycle({state:s,broker,env,save:async()=>{},now:()=>now});assert.equal(r.reason,'OUTSIDE_REGULAR_SESSION');assert.equal(s.preparation.rows.AAPL.candidate,true);assert.deepEqual(s.used,[]);assert.equal(s.pending,null);
 const h=makeHandler({env,storeFactory:()=>({get:async()=>({state:s})})});const d=JSON.parse((await h({httpMethod:'GET'})).body);assert.equal(d.preparation.rows.AAPL.executionReady,false);assert.deepEqual(d.checks,{});
});
