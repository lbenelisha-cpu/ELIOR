import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {makeAuditRecord,auditSnapshots,auditOutcomes} from '../lib/ma-decision-audit.mjs';
const now=Date.parse('2026-11-01T17:07:28.000Z');
const event={platform:'BINANCE',symbol:'SPYBUSDT',at:now,action:'WAIT',reason:'CHANNEL_LIQUIDITY_LOW',price:758.42,bars:[]};
test('ISO and numeric source times produce the same journal freshness and future-price outcome',()=>{
 const iso=makeAuditRecord({...event,priceAt:new Date(now-1000).toISOString()}),numeric=makeAuditRecord({...event,priceAt:now-1000});
 assert.deepEqual(iso,numeric);assert.equal(iso.priceFresh,true);
 const next=makeAuditRecord({...event,at:now+600000,priceAt:new Date(now+600000).toISOString(),price:759});
 assert.equal(auditOutcomes(iso,[next],now+600000)[0].status,'OBSERVED');
});
test('normalizing a source time never refreshes stale, future, missing or malformed quotes',()=>{
 for(const priceAt of [new Date(now-15001).toISOString(),new Date(now+1).toISOString(),null,undefined,0,'','0','not-a-date','2026-11-01',NaN]){
  const r=makeAuditRecord({...event,priceAt});assert.equal(r.priceFresh,false);
  assert.equal(auditOutcomes(r,[],now)[0].status,'BASE_PRICE_UNAVAILABLE');
 }
});
test('the actual Binance observer preserves stream and evaluation ISO times before record creation',()=>{
 const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const start=source.indexOf('function observeMaDecision(event){'),end=source.indexOf('\nsetInterval(',start),rows=[];
 const context=vm.createContext({Date,Map,Number,Object,Math,streams:{SPYBUSDT:{lastPrice:758.42,lastEventAt:new Date(now-1000).toISOString()}},dailyCandleCache:new Map(),maAuditContexts:new Map(),maAudit:{record:r=>rows.push(r)},auditSnapshots,makeAuditRecord,liveManagedPositions:()=>({})});
 vm.runInContext(source.slice(start,end),context);
 context.observeMaDecision({symbol:'SPYBUSDT',at:now,reason:'CHANNEL_LIQUIDITY_LOW'});
 context.observeMaDecision({symbol:'SPYBUSDT',at:now,reason:'CHANNEL_LIQUIDITY_LOW',priceAt:new Date(now-2000).toISOString(),price:758.41});
 assert.equal(rows.length,2);assert.equal(rows[0].priceFresh,true);assert.equal(rows[0].priceAt,now-1000);assert.equal(rows[1].priceAt,now-2000);assert.equal(rows[1].priceFresh,true);
});
