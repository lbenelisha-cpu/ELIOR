import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditSnapshots,makeAuditRecord,auditComparison,collectAudit,appendAuditBatch,readAuditJournal,auditOutcomes,AUDIT_VERSION} from '../lib/ma-decision-audit.mjs';
import {FileMaAudit} from '../lib/ma-audit-file.mjs';
import {createColmexAudit,flushColmexAudit,colmexAuditPrefix} from '../lib/colmex-ma-audit.mjs';
import {makeAuditHandler} from '../netlify/functions/colmex-ma-audit.mjs';
import {pairDevice} from '../lib/colmex-device-access.mjs';
import {runCycle,initialState} from '../lib/colmex-auto-runner.mjs';
import {LIVE_ACK} from '../lib/colmex-auto-policy.mjs';
import {readTarget} from '../netlify/functions/binance-read-proxy.mjs';
const at=Date.UTC(2026,9,26,16,0),step=300000;
const bars=()=>Array.from({length:240},(_,i)=>({openTime:at+(i-240)*step,closeTime:at+(i-239)*step-1,close:100*1.001**i,closed:true}));
const row=(extra={})=>makeAuditRecord({platform:'BINANCE',symbol:'BTCUSDT',at,action:'ENTER',reason:'READY',price:100,priceAt:at-1,bars:bars(),...extra});
function memoryStore(){const data=new Map();return {data,async get(key){return structuredClone(data.get(key)||null);},async getWithMetadata(key){return data.has(key)?{data:structuredClone(data.get(key)),etag:'1'}:null;},async setJSON(key,value){data.set(key,structuredClone(value));return {modified:true,etag:'1'};}};}
test('audit records the exact closed 100/200 bars at both cadences with no future candle leakage',()=>{
 const r=row(),future={openTime:at,closeTime:at+step-1,close:999999,closed:true};
 assert.deepEqual(row({bars:[...bars(),future]}).checks,r.checks);
 assert.deepEqual(r.checks.map(c=>c.checkMinutes),[10,20]);assert.ok(r.checks.every(c=>c.status==='READY'&&c.state==='ENTRY_SUPPORT'&&c.comparison==='SUPPORTS'));
 assert.ok(Math.abs(r.checks[0].ma100.average-bars().slice(-100).reduce((s,b)=>s+b.close,0)/100)<1e-8);assert.equal(r.version,AUDIT_VERSION);
});
test('no entry or protection updates do not manufacture agreement; fills are labelled broker evidence',()=>{
 assert.equal(auditComparison('WAIT',{state:'ENTRY_SUPPORT'}),'NOT_COMPARABLE');assert.equal(auditComparison('PROTECT',{state:'EXIT_WARNING'}),'NOT_COMPARABLE');assert.equal(auditComparison('EXIT',{state:'ENTRY_SUPPORT'}),'OPPOSES');assert.equal(auditComparison('HOLD',{state:'EXIT_WARNING'}),'OPPOSES');
 const r=row({origin:'BROKER',stage:'BROKER_FILL',priceAt:null});assert.equal(r.checks[0].comparison,'NOT_COMPARABLE');assert.equal(r.priceFresh,false);
});
test('cached snapshots cannot move forward a check, use future acquisition, or hide stale source data',()=>{
 const snapshots=auditSnapshots(bars(),at);
 assert.equal(row({bars:undefined,snapshots,at:at+600001}).checks[0].state,'UNAVAILABLE');
 assert.equal(row({bars:undefined,snapshots,at:at-1}).checks[0].state,'UNAVAILABLE');
 assert.equal(row({bars:[]}).checks[0].status,'NO_DATA');assert.equal(row({priceAt:at+1}).priceFresh,false);
 const r=row({priceAt:at-15001});assert.equal(r.priceFresh,false);
});
test('identical evaluations are sampled but changes, new windows and order stages survive; duplicates are idempotent',async()=>{
 const s={},a=row();assert.equal(collectAudit(s,a),true);assert.equal(collectAudit(s,row({at:at+1000})),false);
 assert.equal(collectAudit(s,row({action:'WAIT',at:at+2000})),true);assert.equal(collectAudit(s,row({at:at+3000})),true);
 assert.equal(collectAudit(s,row({at:at+600000})),true);
 const order=row({stage:'ORDER_ATTEMPT',reference:'order-123'}),repeat=row({stage:'ORDER_ATTEMPT',reference:'order-123',at:at+3600000});assert.equal(order.id,repeat.id);
 const store=memoryStore();await appendAuditBatch(store,'test',[order],at);await appendAuditBatch(store,'test',[order],at+1000);assert.equal((await readAuditJournal(store,'test',{now:at+2000})).rows.length,1);
});
test('future-price outcomes use the first fresh observation after the actual horizon, never cached or late quotes',()=>{
 const base=row(),observation=row({at:at+600100,price:105,priceAt:at+600050});
 assert.equal(auditOutcomes(base,[observation],at+600100)[0].status,'OBSERVED');assert.ok(Math.abs(auditOutcomes(base,[observation],at+600100)[0].changePct-5)<1e-8);
 assert.equal(auditOutcomes(base,[row({at:at+600100,priceAt:at+599999})],at+1000000)[0].status,'NO_OBSERVATION');
 assert.equal(auditOutcomes(base,[row({at:at+900001,priceAt:at+900001})],at+1000000)[0].status,'NO_OBSERVATION');
 assert.equal(auditOutcomes(base,[],at+1000)[0].status,'PENDING');assert.equal(auditOutcomes(row({priceAt:null}),[],at+1000)[0].status,'BASE_PRICE_UNAVAILABLE');
});
test('journal reads bound history, isolate symbols, and recover durable records across server restarts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ma-audit-'));try{const log=new FileMaAudit({directory:dir,now:()=>at});log.record(row());await log.flush();
 const restarted=new FileMaAudit({directory:dir,now:()=>at+1000});const view=await restarted.read({symbol:'BTCUSDT'});assert.equal(view.rows.length,1);assert.equal(view.storageError,null);assert.equal((await restarted.read({symbol:'ETHUSDT'})).rows.length,0);await assert.rejects(restarted.read({symbol:'../secret'}),/INVALID_SYMBOL/);if(log.timer)clearTimeout(log.timer);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('storage failures retain the outbox, report failure, retry idempotently, and do not fabricate healthy storage',async()=>{
 const store=memoryStore(),state={},observe=createColmexAudit(state,{},()=>at);observe({symbol:'AAPL',action:'ENTER',reason:'READY',bars:bars(),price:100,priceAt:at});
 const set=store.setJSON;let calls=0;store.setJSON=async(k,v)=>{if(++calls===2)throw Error('storage unavailable');return set(k,v);};
 await flushColmexAudit(store,'123',state,at);assert.equal(state.maAudit.error,'AUDIT_STORAGE_UNAVAILABLE');assert.equal(state.maAudit.rows.length,1);
 store.setJSON=set;await flushColmexAudit(store,'123',state,at+1);assert.equal(state.maAudit.rows.length,0);assert.equal(state.maAudit.error,null);
 assert.equal((await readAuditJournal(store,colmexAuditPrefix('123'),{now:at+1000})).rows.length,1);
});
test('private Colmex endpoint rejects unpaired reads before touching trading or audit state and cannot write',async()=>{
 const env={COLMEX_API_LOGIN:'test-login',COLMEX_API_PASSWORD:'test-password',COLMEX_AUTO_ACCOUNT_ID:'123',COLMEX_DEVICE_PAIR_CODE:'123456'},context={deploy:{context:'production'}},devices=memoryStore(),journal=memoryStore();let stateReads=0;
 const handler=makeAuditHandler({env,deviceStoreFactory:()=>devices,storeFactory:()=>journal,stateStoreFactory:()=>({get:async()=>{stateReads++;return null;}})});
 assert.equal((await handler(new Request('https://test/audit'),context)).status,401);assert.equal(stateReads,0);
 assert.equal((await handler(new Request('https://test/audit',{method:'POST'}),context)).status,405);
 const token=(await pairDevice(devices,{...env,CONTEXT:'production'},'123456')).token;
 assert.equal((await handler(new Request('https://test/audit',{headers:{Authorization:'Bearer '+token}}),context)).status,200);assert.equal(stateReads,1);
 assert.equal(readTarget('/api/binance-ma-audit?symbol=BTCUSDT').pathname,'/api/binance-ma-audit');assert.throws(()=>readTarget('/api/binance-ma-audit?token=secret'));
});
test('a failed analytical observer cannot prevent an emergency close or change quantity, order count or durable-before-write ordering',async()=>{
 const state=initialState(at),saved=[],writes=[],env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123'};
 state.positions=[{id:'p',symbol:'AAPL',qty:2,instrumentId:1,entryPrice:30,peakPrice:30,tickSize:[{leftRangeLimit:0,tickSize:.01}]}];
 const result=await runCycle({state,env,now:()=>at,deadline:at+24000,audit:()=>{throw Error('audit down');},save:async s=>saved.push(structuredClone(s)),broker:{snapshot:async()=>({positions:[{id:'p',tradableInstrumentId:1,side:'buy',qty:2,stopLoss:null}],orders:[],history:[],historyAvailable:true}),write:async(account,intent)=>{assert.equal(saved.at(-1).pending.id,intent.id);writes.push(intent);return {};}}});
 assert.equal(result.reason,'PENDING_BROKER_CONFIRMATION');assert.equal(writes.length,1);assert.equal(writes[0].kind,'CLOSE');assert.equal(writes[0].qty,2);
});
