import {rewindDynamicFixture} from './helpers/pre-dynamic-source.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {patchCurrentEquityAllocation,equityAllocationFiles} from '../scripts/patch-current-equity-allocation.mjs';
import {assertNoPendingEntry} from '../scripts/assert-no-pending-entry.mjs';
import {PersistedMarketOrder} from '../lib/persisted-market-order.mjs';
const patches=JSON.parse(fs.readFileSync(new URL('../scripts/current-equity-allocation-patches.json',import.meta.url),'utf8'));
test('installation waits for the actual durable Spot intent or Futures pending entry without modifying it',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'equity-pending-test-'));
 try{
  const paths={spotPending:path.join(root,'actions.pending'),journal:path.join(root,'actions.futures-short')};
  const order=new PersistedMarketOrder(paths.spotPending);assert.doesNotThrow(()=>assertNoPendingEntry(paths));
  order.pending={params:{symbol:'ABCUSDT',side:'BUY',newClientOrderId:'original-id'}};order.save();
  assert.throws(()=>assertNoPendingEntry(paths),/SPOT_PENDING/);
  assert.equal(new PersistedMarketOrder(paths.spotPending).pending.params.newClientOrderId,'original-id');
  order.pending=null;order.save();assert.doesNotThrow(()=>assertNoPendingEntry(paths));
  fs.writeFileSync(paths.journal,JSON.stringify({pending:{id:'original-short'}}));
  assert.throws(()=>assertNoPendingEntry(paths),/SHORT_PENDING/);
  fs.writeFileSync(paths.journal,JSON.stringify({pending:null}));assert.doesNotThrow(()=>assertNoPendingEntry(paths));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
function fixture(quoteFixed=false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'equity-installer-test-'));
 for(const dir of ['lib','scripts','tests'])fs.cpSync(new URL('../'+dir,import.meta.url),path.join(root,dir),{recursive:true});
 for(const file of ['server.mjs','binance-agent.js','tradingview-exit-snapshot.js','channel-poc-model.js','parallel-channel.js','regression-trend.js'])fs.copyFileSync(new URL('../'+file,import.meta.url),path.join(root,file));
 rewindDynamicFixture(root);
 const server=path.join(root,'server.mjs');fs.writeFileSync(server,fs.readFileSync(server,'utf8').replace('      futuresManualTrading:{version:1,maxOrderUsdt:35},\n',''));
 for(const p of [...patches].reverse()){
  if(quoteFixed&&p.before.includes('positionQuoteAt:'))continue;
  const file=path.join(root,p.file),source=fs.readFileSync(file,'utf8');
  fs.writeFileSync(file,p.fragment?source.replace(p.after,p.before):p.before);
 }
 return root;
}
for(const quoteFixed of [false,true])test('current-equity installer preserves deployed execution and exits, with '+(quoteFixed?'fixed':'legacy')+' quote timestamps',()=>{
 const root=fixture(quoteFixed);try{
  const server=path.join(root,'server.mjs');let s=fs.readFileSync(server,'utf8');
  const start=s.indexOf('async function executeLiveCycle('),end=s.indexOf('async function getLiveAccountSnapshot(',start);
  const deployed=fs.readFileSync(new URL('./fixtures/binance-live-cycle-deployed-20261106.txt',import.meta.url),'utf8');
  fs.writeFileSync(server,s.slice(0,start)+deployed+s.slice(end));
  const journal=JSON.stringify({positions:{ABCUSDT:{entryPrice:100,qty:1,stopPrice:99}},allocation:{baseUsdt:143.6}});
  fs.writeFileSync(path.join(root,'positions.json'),journal);
  patchCurrentEquityAllocation(root);
  assert.ok(fs.readFileSync(server,'utf8').includes(deployed));
  const once=equityAllocationFiles.map(f=>fs.readFileSync(path.join(root,f),'utf8'));patchCurrentEquityAllocation(root);
  assert.deepEqual(equityAllocationFiles.map(f=>fs.readFileSync(path.join(root,f),'utf8')),once);
  assert.equal(fs.readFileSync(path.join(root,'positions.json'),'utf8'),journal);
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const r=spawnSync(process.execPath,[path.join(root,'scripts/test-current-equity-runtime.mjs'),root],{env,encoding:'utf8',timeout:45000,maxBuffer:2000000});
  assert.ifError(r.error);assert.equal(r.status,0,r.stdout+r.stderr);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('unknown helper or duplicate server integration aborts without partial writes',()=>{
 for(const file of ['lib/confirmed-risk-sizing.mjs','lib/live-buy-allocation.mjs','server.mjs']){
  const root=fixture();try{
   fs.appendFileSync(path.join(root,file),file==='server.mjs'?patches.find(p=>p.file===file).before:'\n// unknown version');
   const before=equityAllocationFiles.map(f=>fs.readFileSync(path.join(root,f),'utf8'));
   assert.throws(()=>patchCurrentEquityAllocation(root),/no files changed/);
   assert.deepEqual(equityAllocationFiles.map(f=>fs.readFileSync(path.join(root,f),'utf8')),before);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 }
});
