import test from 'node:test';
import assert from 'node:assert/strict';
import {AutoBroker} from '../lib/colmex-auto-broker.mjs';
import {BrokerWriteError,recordWriteFailure,isValidationRejection} from '../lib/colmex-write-outcome.mjs';
import {pendingDiagnostic,failureDiagnostic} from '../lib/colmex-order-diagnostics.mjs';
import {initialState,runCycle,reconcile} from '../lib/colmex-auto-runner.mjs';
import {LIVE_ACK,AUTO_POLICY} from '../lib/colmex-auto-policy.mjs';
import {manualTrade} from '../lib/colmex-manual-trades.mjs';
const now=Date.parse('2026-10-27T15:55:00Z'),env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123'};
const sizes=[{leftRangeLimit:0,tickSize:.01}],intent=()=>({kind:'BUY',id:'75681804-431a-4ee6-9ff3-5036e4c2fe14',tag:'levi-auto:offline',symbol:'AMD',at:now-7200000,patternId:'consumed',order:{tradableInstrumentId:1,qty:1},tickSize:sizes});
const snapshot=()=>({account:{tradingRules:{supportSelfTrading:true,supportBrackets:true}},state:{availableCash:1287.66,todayTradesCount:0},positions:[],orders:[],history:[],historyAvailable:true});
const fake=()=>({writes:0,scans:[],snapshot:async()=>snapshot(),instruments:async()=>AUTO_POLICY.symbols.map((name,i)=>({name,type:'EQUITY',tradableInstrumentId:i+1})),details:async()=>({quotingCurrency:'USD',symbolStatus:'FULLY_OPEN',tickSize:sizes,lotStep:1,lotSize:1,minLot:1,maxLot:1000}),async history(id){this.scans.push(id);return {barDetails:[]};},quote:async()=>({bp:30,ap:30.01}),async write(){this.writes++;return {orderId:'100'};}});
const ready=()=>({ready:true,reason:'READY',setup:{patternId:'new',springLow:{price:29},targetPrice:40}});
function adapter(fetchImpl,clock=()=>now,deadline=now+27000){const b=new AutoBroker({env,deadline,now:clock,fetchImpl});b.reader.authorize=async()=> 'offline-token';return b;}

test('preflight deadline, authentication and post-auth deadline failures prove no order was sent',async()=>{
 for(const kind of ['deadline','auth','slow-auth']){
  let calls=0,clock=now;const b=adapter(async()=>{calls++;},()=>clock,kind==='deadline'?now+1000:now+27000);
  if(kind==='auth')b.reader.authorize=async()=>{throw Error('private credentials');};
  if(kind==='slow-auth')b.reader.authorize=async()=>{clock+=22000;return 'offline-token';};
  await assert.rejects(b.write('123',intent()),e=>e instanceof BrokerWriteError&&e.outcome==='NOT_SENT');assert.equal(calls,0);
 }
});
test('ambiguous broker responses preserve the reservation and never retry',async()=>{
 const cases=[()=>{throw Error('network');},()=>({ok:true,status:200,json:async()=>{throw Error('invalid JSON');}}),()=>({ok:true,status:200,json:async()=>({s:'ok'})}),
 ...[200,400,401,403,429,500].map(status=>()=>({ok:status===200,status,json:async()=>({s:'error',errmsg:'Processing result unknown; secret-account-data'})}))];
 for(const response of cases){
  let calls=0;const b=adapter(async()=>{calls++;return response();}),s=initialState(now);s.pending=intent();
  try{await b.write('123',s.pending);assert.fail('must fail');}catch(e){const r=recordWriteFailure(s,s.pending,e,now);assert.equal(r.resolved,false);assert.equal(r.failure.outcome,'UNKNOWN');}
  assert.equal(calls,1);assert.ok(s.pending);assert.equal(JSON.stringify(s).includes('secret-account-data'),false);
 }
});
test('only explicit HTTP 400 parameter validation rejection releases a failed intent',async()=>{
 const b=adapter(async()=>({ok:false,status:400,json:async()=>({s:'error',errmsg:'Invalid quantity: must be greater than zero'})})),s=initialState(now);s.pending=intent();
 try{await b.write('123',s.pending);assert.fail('must fail');}catch(e){const r=recordWriteFailure(s,s.pending,e,now);assert.equal(r.failure.outcome,'REJECTED');assert.equal(r.failure.httpStatus,400);assert.equal(r.resolved,true);}
 assert.equal(s.pending,null);
 for(const message of ['Invalid quantity after timeout','Invalid price: duplicate request','Invalid stopLoss; order already accepted','Invalid quantity; execution result unknown','Order rejected'])assert.equal(isValidationRejection(400,{s:'error',errmsg:message}),false);
 assert.equal(isValidationRejection(500,{s:'error',errmsg:'Invalid quantity'}),false);
 assert.equal(isValidationRejection(400,{s:'error',errmsg:'Invalid quantity',d:{orderId:'1'}}),false);
});
test('untyped or legacy errors cannot claim definitive rejection',()=>{
 const s=initialState(now);s.pending=intent();const error=Object.assign(Error('token secret'),{outcome:'REJECTED',code:'WRITE_VALIDATION_REJECTED',httpStatus:400});
 assert.equal(recordWriteFailure(s,s.pending,error,now).resolved,false);assert.ok(s.pending);assert.equal(s.lastWriteFailure.code,'WRITE_OUTCOME_UNKNOWN');
});
test('blocked cycles scan the entire universe without consuming signals or placing an order',async()=>{
 const s=initialState(now-1000),b=fake();s.pending=intent();s.used=['consumed'];s.halt='UNRESOLVED_ORDER_REQUIRES_REVIEW';const original=structuredClone(s.pending);
 for(let i=0;i<10;i++){
  const clock=now+i*60000;
  const result=await runCycle({state:s,save:async()=>{},broker:b,env,now:()=>clock,deadline:clock+27000,signal:ready});
  assert.equal(result.reason,'UNRESOLVED_ORDER_REQUIRES_REVIEW');assert.equal(s.scanActivity.mode,'OBSERVATION_ONLY');
 }
 assert.equal(b.writes,0);assert.equal(b.scans.length,50);assert.equal(Object.keys(s.checks).length,50);assert.deepEqual(s.used,['consumed']);
 for(const k of ['id','at','tag','order'])assert.deepEqual(s.pending[k],original[k]);
 assert.ok(Object.values(s.checks).every(c=>c.reason==='SIGNAL_READY_OBSERVATION_ONLY'&&c.entryBlockReason===s.halt));
 assert.equal(s.pending.reconciliation.matches,0);assert.equal(s.pending.reconciliation.relatedHistoryCount,0);
});
test('pending observation scans still obey deadlines and broker rate limits',async()=>{
 for(const limited of [true,false]){
  const s=initialState(now-1000),b=fake();s.pending=intent();if(limited)b.history=async()=>{throw Object.assign(Error('rate limited'),{code:'RATE_LIMIT'});};
  const r=await runCycle({state:s,save:async()=>{},broker:b,env,now:()=>now,deadline:now+(limited?27000:8000),signal:ready});
  assert.equal(r.reason,limited?'RATE_LIMIT':'CYCLE_DEADLINE');assert.equal(b.writes,0);assert.ok(s.pending);
 }
});
test('confirmed pre-write failure persists the diagnosis without retaining an impossible pending buy',async()=>{
 const s=initialState(now-1000),b=fake();let saved;
 b.write=async()=>{throw new BrokerWriteError('WRITE_AUTH_FAILED',{outcome:'NOT_SENT'});};
 const r=await runCycle({state:s,save:async state=>{saved=structuredClone(state);},broker:b,env,now:()=>now,deadline:now+27000,signal:ready});
 assert.equal(r.reason,'WRITE_AUTH_FAILED');assert.equal(saved.pending,null);assert.equal(saved.lastWriteFailure.outcome,'NOT_SENT');assert.deepEqual(saved.used,['new']);
});
test('manual rejected request is terminal and same request cannot submit again',async()=>{
 const s=initialState(now-1000),b=fake();b.write=async()=>{b.writes++;throw new BrokerWriteError('WRITE_VALIDATION_REJECTED',{outcome:'REJECTED',httpStatus:400});};
 const args={input:{side:'BUY',symbol:'AAPL',amountUsd:100,requestId:intent().id},state:s,save:async()=>{},broker:b,env,now:()=>now,deadline:now+27000};
 assert.equal((await manualTrade(args)).status,'REJECTED');assert.equal(s.pending,null);assert.equal((await manualTrade(args)).status,'REJECTED');assert.equal(b.writes,1);
});
test('empty broker state and old manual history do not clear an unknown order',()=>{
 const s=initialState(now);s.pending=intent();s.halt='UNRESOLVED_ORDER_REQUIRES_REVIEW';
 reconcile(s,{...snapshot(),history:[{id:'manual',tradableInstrumentId:2,status:'cancelled',filledQty:0}]},now);
 assert.ok(s.pending);assert.equal(s.halt,'UNRESOLVED_ORDER_REQUIRES_REVIEW');assert.equal(s.pending.reconciliation.historyCount,1);assert.equal(s.pending.reconciliation.matches,0);
 delete s.pending.tag;reconcile(s,{...snapshot(),history:[{id:'manual',tradableInstrumentId:1,status:'cancelled',filledQty:0}]},now+60000);assert.ok(s.pending);
});
test('public diagnostics omit raw error bodies and identify legacy missing failure details',()=>{
 const p=intent();p.order.password='private';p.reconciliation={at:now,historyAvailable:true,historyCount:2,openOrders:0,openPositions:0,matches:0,relatedHistoryCount:0,matchBy:'COMMENT',raw:'private'};
 const d=pendingDiagnostic(p);assert.equal(d.failure,null);assert.equal(d.requestId,p.id);assert.equal(d.acknowledged,false);assert.equal(JSON.stringify(d).includes('private'),false);
 assert.equal(failureDiagnostic({code:'private',outcome:'private',httpStatus:'private',responseStatus:'private',errmsg:'private'}).code,'WRITE_OUTCOME_UNKNOWN');
});
