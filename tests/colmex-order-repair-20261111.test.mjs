import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewOctoberReservations,octoberReviewSummary} from '../lib/colmex-order-repair-20261111.mjs';
import {initialState,runCycle,reconcile} from '../lib/colmex-auto-runner.mjs';
import {reservedAccount} from '../lib/colmex-order-review.mjs';
import {validateLiveState,pendingIntents} from '../lib/colmex-live-state.mjs';
import {LIVE_ACK} from '../lib/colmex-auto-policy.mjs';
const now=Date.parse('2026-11-11T20:00:00Z');
const env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123'};
function fixture(){
 const s=initialState(now-30*86400000);
 const intent=(id,symbol,at,price,instrument)=>({id,symbol,at,kind:'BUY',tag:'levi-auto:'+id,reviewRequired:true,quarantinedAt:at+86400000,order:{tradableInstrumentId:instrument,side:'buy',type:'limit',validity:'IOC',qty:1,price},patternId:'old-'+symbol});
 s.pending=intent('60a175b9-d968-42ff-b40c-992779086166','AMD',1793116509071,560.83,9);
 s.riskPending=[intent('a3efb8c5-c9ab-4323-aaaa-dda5f86799a4','TGT',1793197571357,444.99,10)];
 s.used=['old-AMD','old-TGT'];
 const snap={account:{id:'123',type:'live',currency:'USD',status:'ACTIVE'},state:{positionsCount:0,ordersCount:0,blockedBalance:0,stockOrdersReq:0,blockedForStocks:0,totalPositionsValue:0,openGrossPnL:0,initialMarginReq:0,maintMarginReq:0,availableCash:1287.66,cashBalance:1287.66,balance:1287.66},positions:[],orders:[],history:[],historyAvailable:true};
 return {s,snap};
}
const review=(s,snap,at)=>{reconcile(s,snap,at);return reviewOctoberReservations(s,snap,'123',at);};
test('two independent empty snapshots archive only reservations, preserve all evidence and require new signals',()=>{
 const {s,snap}=fixture();const original=structuredClone(pendingIntents(s));
 assert.equal(reservedAccount(s,snap).cash,271.84000000000003);
 assert.equal(review(s,snap,now),'OLD_ORDER_REVIEW_VERIFYING');assert.equal(pendingIntents(s).length,2);
 assert.equal(review(s,snap,now+2000),'OLD_ORDER_REVIEW_VERIFYING');assert.equal(pendingIntents(s).length,2);
 assert.equal(review(s,snap,now+60000),'OLD_ORDER_RESERVATIONS_ARCHIVED');
 assert.equal(pendingIntents(s).length,0);assert.equal(reservedAccount(s,snap).cash,1287.66);assert.equal(reservedAccount(s,snap).orders.length,0);
 assert.equal(s.octoberOrderReview.intents.length,2);assert.deepEqual(s.octoberOrderReview.intents.map(i=>i.order),original.map(i=>i.order));
 assert.equal(s.octoberOrderReview.historicalOutcome,'UNKNOWN');assert.equal(s.after.AMD,now+60000);assert.equal(s.after.TGT,now+60000);
 assert.deepEqual(s.used,['old-AMD','old-TGT']);assert.equal(s.closedTrades,undefined);validateLiveState(s);
 assert.equal(review(s,snap,now+120000),null);assert.equal(s.octoberOrderReview.intents.length,2);
 const publicView=octoberReviewSummary(s);assert.equal(publicView.releasedUsd,1015.82);assert.equal(publicView.intents,undefined);assert.equal(publicView.brokerEvidence,undefined);
});
test('changed requests, acknowledgement, non-IOC, another account, live exposure or incomplete proof never release',()=>{
 const mutations=[
  s=>s.pending.id='other',s=>s.pending.symbol='NVDA',s=>s.pending.at++,s=>s.pending.order.price++,s=>s.pending.order.validity='GTC',s=>s.pending.manual=true,s=>s.pending.acceptedAt=now-1,s=>s.pending.orderId='o',s=>s.pending.quarantinedAt=null,s=>s.halt='AMBIGUOUS_ORDER',
  (s,b)=>b.account.id='999',(s,b)=>b.positions.push({id:'p',tradableInstrumentId:20,qty:1,side:'buy'}),(s,b)=>b.orders.push({id:'o',tradableInstrumentId:20,side:'buy'}),(s,b)=>b.historyAvailable=false,(s,b)=>b.state.positionsCount=1,(s,b)=>delete b.state.ordersCount,(s,b)=>b.state.blockedBalance=1,(s,b)=>b.state.availableCash=1000,
  (s,b)=>b.history.push({id:'unmatched',tradableInstrumentId:9})
 ];
 for(const change of mutations){const {s,snap}=fixture();change(s,snap);review(s,snap,now);review(s,snap,now+60000);assert.equal(pendingIntents(s).length,2);assert.notEqual(s.octoberOrderReview?.status,'ARCHIVED');}
});
test('interrupted empty proof restarts verification; out-of-window and partial target sets stay untouched',()=>{
 const {s,snap}=fixture();review(s,snap,now);snap.historyAvailable=false;review(s,snap,now+60000);assert.equal(s.octoberOrderReview,undefined);snap.historyAvailable=true;
 assert.equal(review(s,snap,now+120000),'OLD_ORDER_REVIEW_VERIFYING');assert.equal(pendingIntents(s).length,2);
 const a=fixture();assert.equal(review(a.s,a.snap,now+8*86400000),null);
 a.s.riskPending=[];assert.equal(review(a.s,a.snap,now),null);assert.ok(a.s.pending);
});
test('real cycle saves archive under its existing lease and returns without a broker write or scan',async()=>{
 const {s,snap}=fixture();let at=now,persisted,reads=0,writes=0;
 const broker={snapshot:async()=>{reads++;return structuredClone(snap);},write:async()=>{writes++;throw Error('must not trade');},instruments:async()=>{throw Error('must not scan in review cycle');}};
 const run=()=>runCycle({state:s,save:async v=>{persisted=structuredClone(v);},broker,env,now:()=>at,deadline:at+24000});
 assert.equal((await run()).reason,'OLD_ORDER_REVIEW_VERIFYING');at+=60000;
 assert.equal((await run()).reason,'OLD_ORDER_RESERVATIONS_ARCHIVED');assert.equal(writes,0);assert.equal(reads,2);assert.equal(persisted.octoberOrderReview.status,'ARCHIVED');assert.equal(pendingIntents(persisted).length,0);
});
test('failed archive persistence never continues to order execution',async()=>{
 const {s,snap}=fixture();review(s,snap,now);let writes=0;
 await assert.rejects(runCycle({state:s,save:async()=>{throw Error('LEASE_LOST');},broker:{snapshot:async()=>snap,write:async()=>writes++},env,now:()=>now+60000,deadline:now+84000}),/LEASE_LOST/);assert.equal(writes,0);
});
