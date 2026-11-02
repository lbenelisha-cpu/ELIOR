import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {BinancePoc,pocInput} from '../lib/binance-poc.mjs';
const input={requestId:'poc-12345678-1234-1234-1234-123456789abc',mode:'live',confirmed:true,symbol:'ETHUSDT',side:'LONG',direction:'ABOVE',poc:100,quoteUsdt:20,expiresHours:1};
function harness(t,patch={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'poc-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const h={now:1000000,price:99,priceAt:1000000,allow:true,settings:{takeProfitPct:50,stopLossPct:1,profitActivationPct:5,trailingGapPp:1},posts:0};
 h.options={file:path.join(dir,'poc.json'),now:()=>h.now,quote:async()=>({price:h.price,at:h.priceAt}),control:()=>({allowEntries:h.allow}),settings:()=>h.settings,execute:async(row,guard)=>{await guard();h.posts++;return {ok:true,order:{orderId:1,status:'FILLED',executedQty:'.2'}};},reconcile:async()=>null,...patch};
 h.runner=new BinancePoc(h.options);return h;
}
test('POC is explicit, bounded and cannot accept bad numbers or arbitrary sides',()=>{
 for(const patch of [{confirmed:false},{mode:'demo'},{side:'BUY'},{poc:'100'},{poc:Infinity},{quoteUsdt:401},{side:'SHORT',quoteUsdt:36},{expiresHours:0},{symbol:'<script>'},{requestId:'../etc'}])assert.throws(()=>pocInput({...input,...patch}));
 assert.equal(pocInput({...input,side:'SHORT',quoteUsdt:35}).quoteUsdt,35);
});
test('durable waiting survives restart, crosses once, and repeated creates cannot trade again',async t=>{
 const h=harness(t);await h.runner.create(input);assert.equal(h.posts,0);assert.equal(h.runner.reserved('ETHUSDT','LONG'),true);
 h.runner=new BinancePoc(h.options);await h.runner.create(input);h.price=100;await h.runner.tick();await h.runner.tick();
 h.runner=new BinancePoc(h.options);await h.runner.tick();await h.runner.create(input);
 assert.equal(h.posts,1);assert.equal(h.runner.snapshot().rows[0].status,'FILLED');assert.equal(h.runner.reserved('ETHUSDT','LONG'),false);
 assert.equal(fs.statSync(h.options.file).mode&0o777,0o600);
 await assert.rejects(h.runner.create({...input,quoteUsdt:21}),/ID_CONFLICT/);
});
test('cancel is durable and cancellation during a quote read wins before dispatch',async t=>{
 const h=harness(t);await h.runner.create(input);h.price=100;
 h.runner.quote=async()=>{h.runner.cancel(input.requestId);return {price:100,at:h.now};};await h.runner.tick();
 h.runner=new BinancePoc(h.options);await h.runner.tick();assert.equal(h.posts,0);assert.equal(h.runner.snapshot().rows[0].status,'CANCELLED');
});
test('stale prices, pause, price gaps and expiration cannot enter',async t=>{
 const h=harness(t);await h.runner.create(input);h.price=100;h.priceAt-=11000;await h.runner.tick();assert.equal(h.posts,0);
 h.priceAt=h.now;h.allow=false;await h.runner.tick();assert.equal(h.posts,0);h.allow=true;
 h.price=101;await h.runner.tick();assert.equal(h.runner.snapshot().rows[0].status,'MISSED');assert.equal(h.posts,0);
 const e=harness(t);await e.runner.create(input);e.now+=3600000;e.priceAt=e.now;e.price=100;await e.runner.tick();assert.equal(e.runner.snapshot().rows[0].status,'EXPIRED');assert.equal(e.posts,0);
});
test('SHORT can wait for a rise or fall; already met levels are rejected at creation',async t=>{
 const h=harness(t);await assert.rejects(h.runner.create({...input,side:'SHORT',direction:'BELOW'}),/ALREADY_REACHED/);
 h.price=101;await h.runner.create({...input,side:'SHORT',direction:'BELOW'});h.price=100;await h.runner.tick();assert.equal(h.posts,1);
});
test('a crash or network ambiguity after durable dispatch can only reconcile, never resubmit',async t=>{
 const h=harness(t);h.runner.execute=async()=>{h.posts++;throw Error('timeout');};await h.runner.create(input);h.price=100;await h.runner.tick();
 assert.equal(h.runner.snapshot().rows[0].status,'UNKNOWN');h.runner=new BinancePoc(h.options);await h.runner.tick();assert.equal(h.posts,1);
 h.runner.reconcile=async()=>({ok:true,order:{orderId:55,executedQty:'.2',status:'FILLED'}});await h.runner.tick();assert.equal(h.runner.snapshot().rows[0].status,'FILLED');assert.equal(h.posts,1);
 const state=JSON.parse(fs.readFileSync(h.options.file));state.rows[0].status='EXECUTING';fs.writeFileSync(h.options.file,JSON.stringify(state));
 h.runner=new BinancePoc(h.options);await h.runner.tick();assert.equal(h.posts,1);assert.equal(h.runner.snapshot().rows[0].status,'UNKNOWN');
});
test('final price, control, expiry and settings are rechecked inside the execution adapter',async t=>{
 for(const change of [h=>h.price=99,h=>h.price=101,h=>h.allow=false,h=>h.settings={...h.settings,stopLossPct:2},h=>{h.now+=3600000;h.priceAt=h.now;}]){
  const h=harness(t);await h.runner.create(input);h.price=100;
  h.runner.execute=async(row,guard)=>{change(h);try{await guard();h.posts++;return {ok:true};}catch(e){return {ok:false,error:e.message};}};
  await h.runner.tick();assert.equal(h.posts,0);assert.equal(h.runner.snapshot().rows[0].status,'FAILED');
 }
});
test('unknown and executing entries reject cancellation, while stop-all cancels waiting rows',async t=>{
 const h=harness(t);await h.runner.create(input);h.runner.cancelWaiting();assert.equal(h.runner.snapshot().rows[0].status,'CANCELLED');
 const e=harness(t);await e.runner.create(input);e.runner.state.rows[0].status='UNKNOWN';assert.throws(()=>e.runner.cancel(input.requestId),/ALREADY_DISPATCHED/);
});
test('corrupt journals and failed fsync block all dispatch, and concurrent ticks cannot duplicate',async t=>{
 const h=harness(t);await h.runner.create(input);h.price=100;
 h.runner.saveImpl=()=>{throw Error('disk');};await h.runner.tick();assert.equal(h.posts,0);assert.equal(h.runner.snapshot().error,'POC_JOURNAL_WRITE_FAILED');
 fs.writeFileSync(h.options.file,'bad');const broken=new BinancePoc(h.options);await broken.tick();await assert.rejects(broken.create(input),/UNREADABLE/);
 const a=harness(t);await a.runner.create(input);a.price=100;await Promise.all([a.runner.tick(),a.runner.tick(),a.runner.tick()]);assert.equal(a.posts,1);
});

test('a busy executor explicitly defers without sending, then executes once when free',async t=>{
 const h=harness(t);await h.runner.create(input);h.price=100;const execute=h.runner.execute;
 h.runner.execute=async()=>({deferred:true,error:'POC_EXECUTION_BUSY'});await h.runner.tick();assert.equal(h.posts,0);assert.equal(h.runner.snapshot().rows[0].status,'WAITING');
 h.runner.execute=execute;await h.runner.tick();assert.equal(h.posts,1);assert.equal(h.runner.snapshot().rows[0].status,'FILLED');
});
