import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseOrderReview,reservedAccount} from '../lib/colmex-order-review.mjs';
import {initialState,runCycle,reconcile} from '../lib/colmex-auto-runner.mjs';
import {manualTrade} from '../lib/colmex-manual-trades.mjs';
import {validateLiveState,hasBlockingPending} from '../lib/colmex-live-state.mjs';
import {AUTO_POLICY,LIVE_ACK} from '../lib/colmex-auto-policy.mjs';
import {makeHandler} from '../netlify/functions/colmex-auto-status.mjs';
import {monitorView} from '../lib/colmex-monitor-view.mjs';
import {orderReviewOffer,manualDiagnosticOffer} from '../lib/colmex-manual-diagnostic.mjs';
const now=Date.parse('2026-10-27T16:00:00Z'),id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actionId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123'};
const input={action:'release_review',requestId:actionId,reviewRequestId:id};
const ticks=[{leftRangeLimit:0,tickSize:.01}];
function state(){const s=initialState(now-7200000);s.halt='UNRESOLVED_ORDER_REQUIRES_REVIEW';s.pending={kind:'BUY',id,tag:'levi-auto:'+id,at:now-3600000,symbol:'AMD',reviewRequired:true,order:{tradableInstrumentId:9,qty:4,price:200},tickSize:ticks};return s;}
const snapshot=()=>({account:{tradingRules:{supportSelfTrading:true,supportBrackets:true}},state:{availableCash:1287.66},positions:[],orders:[],history:[],historyAvailable:true});
function broker(){return {writes:[],snapshot:async()=>snapshot(),instruments:async()=>AUTO_POLICY.symbols.map((name,i)=>({name,type:'EQUITY',tradableInstrumentId:name==='AMD'?9:name==='AAPL'?1:i+100})),details:async()=>({quotingCurrency:'USD',symbolStatus:'FULLY_OPEN',tickSize:ticks,lotStep:1,lotSize:1,minLot:1,maxLot:1000}),quote:async()=>({bp:29.99,ap:30}),history:async()=>({barDetails:[]}),async write(account,i){this.writes.push(structuredClone(i));return {orderId:'new-order'};}};}
const args=(s,b)=>({input,state:s,broker:b,env,now:()=>now,save:async s=>validateLiveState(s)});
test('owner release keeps unresolved intent and reserved cash, never invokes broker write, and is idempotent',async()=>{
 const s=state(),b=broker();const result=await releaseOrderReview(args(s,b));
 assert.equal(result.status,'REVIEW_RELEASED');assert.equal(result.reservedUsd,805);assert.equal(s.pending.id,id);assert.equal(s.pending.quarantinedAt,now);assert.equal(s.halt,null);assert.equal(hasBlockingPending(s),false);assert.equal(b.writes.length,0);
 const account=reservedAccount(s,snapshot());assert.ok(Math.abs(account.cash-482.66)<1e-8);assert.equal(account.orders.length,1);
 const retry=structuredClone(s);await releaseOrderReview({...args(retry,b),broker:{snapshot:()=>{throw Error('idempotent replay must not reread');}}});assert.equal(b.writes.length,0);
 await assert.rejects(releaseOrderReview({...args(retry,b),input:{...input,reviewRequestId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}}),/REQUEST_ID_CONFLICT/);
 reconcile(s,snapshot(),now+3600000);assert.equal(s.halt,null);assert.equal(s.pending.reviewRequired,true);
});
test('release rejects wrong identity, nonlegacy halts, acknowledged orders, occupied or unverified accounts',async()=>{
 for(const change of ['identity','halt','ack','extra','history','position','order','match']){
  const s=state(),b=broker();let payload=input,snap=snapshot();
  if(change==='identity')payload={...input,reviewRequestId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'};
  if(change==='halt')s.halt='POSITION_OWNERSHIP_REQUIRES_REVIEW';
  if(change==='ack')s.pending.orderId='known';
  if(change==='extra')s.riskPending=[{kind:'CLOSE',id:'other',positionId:'p',symbol:'AAPL',at:now}];
  if(change==='history')snap.historyAvailable=false;
  if(change==='position')snap.positions=[{id:'p',tradableInstrumentId:1}];
  if(change==='order')snap.orders=[{id:'other',tradableInstrumentId:1}];
  if(change==='match')snap.history=[{id:'broker-order',userComment:s.pending.tag,status:'accepted'}];
  b.snapshot=async()=>snap;
  await assert.rejects(releaseOrderReview({...args(s,b),input:payload}),undefined,change);assert.equal(s.pending.quarantinedAt,undefined);assert.equal(b.writes.length,0);
 }
});
test('failed durable release leaves saved state blocked and no financial call is possible',async()=>{
 const s=state(),b=broker();let persisted;
 await assert.rejects(releaseOrderReview({...args(s,b),save:async next=>{if(next.pending.quarantinedAt)throw Error('storage');persisted=structuredClone(next);}}),/storage/);
 assert.equal(persisted.halt,'UNRESOLVED_ORDER_REQUIRES_REVIEW');assert.equal(persisted.pending.quarantinedAt,undefined);assert.equal(b.writes.length,0);
 const invalid=state();invalid.pending.quarantinedAt='yes';assert.throws(()=>validateLiveState(invalid),/STATE_SCHEMA/);
});
test('manual buys can use remaining cash on other instruments; old instrument and oversized budgets stay blocked',async()=>{
 for(const [symbol,amountUsd,error] of [['AAPL',200,null],['AMD',200,'SYMBOL_ORDER_UNRESOLVED'],['AAPL',800,'INSUFFICIENT_UNLEVERAGED_CASH']]){
  const s=state(),b=broker();await releaseOrderReview(args(s,b));
  const req={side:'BUY',symbol,amountUsd,requestId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'};
  const run=()=>manualTrade({...args(s,b),input:req,deadline:now+24000});
  if(error){await assert.rejects(run(),new RegExp(error));assert.equal(b.writes.length,0);}else{await run();assert.equal(b.writes.length,1);assert.equal(s.riskPending[0].symbol,'AAPL');assert.equal(hasBlockingPending(s),true);}
  assert.equal(s.pending.id,id);
 }
});
test('worker observes the quarantined stock and can buy another without consuming original reservation',async()=>{
 const s=state(),b=broker();await releaseOrderReview(args(s,b));s.cursor=AUTO_POLICY.symbols.indexOf('AMD');
 b.snapshot=async()=>({...snapshot(),state:{availableCash:3000}});
 await runCycle({...args(s,b),deadline:now+24000,signal:()=>({ready:true,setup:{patternId:'fixture-new',targetPrice:100}})});
 assert.equal(s.checks.AMD.entryBlockReason,'SYMBOL_ORDER_UNRESOLVED');assert.equal(b.writes.length,1);assert.equal(b.writes[0].kind,'BUY');assert.notEqual(b.writes[0].symbol,'AMD');assert.equal(s.pending.id,id);assert.equal(s.halt,null);
});
test('late conclusive broker evidence resolves quarantine; ambiguous evidence still halts the account',async()=>{
 for(const kind of ['no-fill','fill','ambiguous']){
  const s=state(),b=broker();await releaseOrderReview(args(s,b));const snap=snapshot(),base={id:'o',userComment:s.pending.tag,tradableInstrumentId:9};
  if(kind==='no-fill')snap.history=[{...base,status:'cancelled',filledQty:0}];
  if(kind==='fill'){snap.history=[{...base,status:'filled',filledQty:4,avgPrice:200,positionId:'p'}];snap.positions=[{id:'p',tradableInstrumentId:9,qty:4,avgPrice:200,side:'buy',stopLoss:198}];}
  if(kind==='ambiguous')snap.history=[{...base,status:'accepted'},{...base,id:'o2',status:'accepted'}];
  reconcile(s,snap,now+60000);
  if(kind==='ambiguous'){assert.equal(s.halt,'AMBIGUOUS_ORDER');assert.ok(s.pending);}else{assert.equal(s.pending,null);assert.equal(s.halt,null);assert.equal(s.positions.length,kind==='fill'?1:0);}
 }
});
test('public status separates symbol quarantine from a globally pending action',async()=>{
 const s=state(),b=broker();await releaseOrderReview(args(s,b));s.lastCycleAt=now;
 const h=makeHandler({env,storeFactory:()=>({get:async()=>({state:s})})});
 const data=JSON.parse((await h({httpMethod:'GET'})).body);assert.equal(data.status,'MONITORING');assert.equal(data.halt,null);assert.equal(data.pending.quarantined,true);assert.equal(data.pending.reservedUsd,805);assert.equal(data.reviewRecovery.available,false);
 assert.equal(monitorView({...data,scanActivity:{at:now,mode:'OBSERVATION_ONLY',dataAvailable:true}},now).observationScanning,false);
});
const secondId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
function secondReview(){
 const s=state();s.pending.quarantinedAt=now-300000;
 s.pending.order={...s.pending.order,qty:3,price:186.94333333333333};
 s.riskPending=[{...structuredClone(state().pending),id:secondId,tag:'levi-auto:'+secondId,symbol:'TGT',order:{tradableInstrumentId:10,qty:6,price:100}}];
 return s;
}
const secondInput={...input,reviewRequestId:secondId};
test('targeted review selects the blocking TGT intent after isolated AMD and preserves both reservations',async()=>{
 for(const reversed of [false,true]){
  const s=secondReview(),b=broker();if(reversed)[s.pending,s.riskPending[0]]=[s.riskPending[0],s.pending];
  const offer=orderReviewOffer(s);assert.equal(offer.reviewRequestId,secondId);assert.equal(offer.blockedSymbol,'TGT');assert.equal(offer.available,true);assert.equal(manualDiagnosticOffer(s).available,false);
  assert.ok(Math.abs(offer.existingReservedUsd-565.83)<1e-8);assert.ok(Math.abs(offer.totalReservedUsd-1170.83)<1e-8);assert.deepEqual(offer.excludedSymbols,['AMD','TGT']);assert.equal(offer.reservedSlots,2);
  const result=await releaseOrderReview({...args(s,b),input:secondInput});
  assert.equal(result.symbol,'TGT');assert.equal(hasBlockingPending(s),false);assert.equal(s.halt,null);assert.equal(b.writes.length,0);
  assert.ok(Math.abs(result.availableCashAfterReservations-116.83)<1e-8);assert.equal(reservedAccount(s,snapshot()).orders.length,2);
  const all=[s.pending,...s.riskPending];assert.equal(all.find(i=>i.id===id).quarantinedAt,now-300000);assert.equal(all.find(i=>i.id===secondId).quarantinedAt,now);
  assert.deepEqual(await releaseOrderReview({...args(s,b),input:secondInput,broker:{snapshot(){throw Error('must not reread');}}}),result);
 }
});
test('targeted release never hides a second blocker or accepts an isolated, manual or acknowledged target',async()=>{
 for(const change of ['extra-buy','extra-exit','manual','ack','old-id','isolated']){
  const s=secondReview(),b=broker();let request=secondInput;
  if(change==='extra-buy')s.riskPending.push({...structuredClone(s.riskPending[0]),id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',symbol:'AAPL'});
  if(change==='extra-exit')s.riskPending.push({kind:'CLOSE',id:'other',positionId:'p',symbol:'AAPL',at:now});
  if(change==='manual')s.riskPending[0].manual=true;
  if(change==='ack')s.riskPending[0].acceptedAt=now;
  if(change==='old-id')request=input;
  if(change==='isolated')s.riskPending[0].quarantinedAt=now;
  await assert.rejects(releaseOrderReview({...args(s,b),input:request}),/REVIEW_STATE_CHANGED/,change);
  assert.equal(s.halt,'UNRESOLVED_ORDER_REQUIRES_REVIEW');assert.equal(b.writes.length,0);
 }
});
test('fresh broker evidence for either pending stock prevents blind release',async()=>{
 for(const evidence of ['AMD','TGT','TGT-no-fill']){
  const s=secondReview(),b=broker(),target=evidence==='AMD'?s.pending:s.riskPending[0];
  b.snapshot=async()=>({...snapshot(),history:[{id:'broker-order',userComment:target.tag,tradableInstrumentId:target.order.tradableInstrumentId,status:evidence==='TGT-no-fill'?'cancelled':'accepted',filledQty:0}]});
  await assert.rejects(releaseOrderReview({...args(s,b),input:secondInput}));assert.equal(b.writes.length,0);assert.equal(s.pending.quarantinedAt,now-300000);
  if(evidence==='TGT-no-fill'){assert.equal(s.riskPending.length,0);assert.equal(s.halt,null);assert.ok(s.events.some(e=>e.reason==='BUY_FINISHED_WITHOUT_FILL'&&e.symbol==='TGT'));}
  else {assert.equal(s.riskPending[0].quarantinedAt,undefined);assert.equal(s.halt,'UNRESOLVED_ORDER_REQUIRES_REVIEW');}
 }
});
test('combined reservations still block automatic and manual overspending and both isolated symbols',async()=>{
 const s=secondReview(),b=broker();await releaseOrderReview({...args(s,b),input:secondInput});
 await runCycle({...args(s,b),deadline:now+24000,signal:()=>({ready:true,setup:{patternId:'fixture-multi',targetPrice:100}})});
 assert.equal(b.writes.length,0);assert.ok(Object.values(s.checks).some(c=>c.reason==='INSUFFICIENT_UNLEVERAGED_CASH'));
 for(const symbol of ['AAPL','AMD','TGT']){
  const expected=symbol==='AAPL'?'INSUFFICIENT_UNLEVERAGED_CASH':'SYMBOL_ORDER_UNRESOLVED';
  const realInstruments=b.instruments;b.instruments=async()=>[...(await realInstruments()).filter(i=>i.name!=='TGT'),{name:'TGT',type:'EQUITY',tradableInstrumentId:10}];
  await assert.rejects(manualTrade({...args(s,b),input:{side:'BUY',symbol,amountUsd:200,requestId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'},deadline:now+24000}),new RegExp(expected));
 }
 assert.equal(b.writes.length,0);assert.equal(reservedAccount(s,snapshot()).orders.length,2);
});
test('status GET offers the exact blocking order without releasing it or expanding diagnostic buys',async()=>{
 const s=secondReview(),original=structuredClone(s),h=makeHandler({env,storeFactory:()=>({get:async()=>({state:s})})});
 const data=JSON.parse((await h({httpMethod:'GET'})).body);
 assert.equal(data.reviewRecovery.available,true);assert.equal(data.reviewRecovery.reviewRequestId,secondId);assert.equal(data.reviewRecovery.version,'ORDER_REVIEW_RECOVERY_V2');assert.equal(data.manualDiagnostic.available,false);assert.deepEqual(s,original);
});
