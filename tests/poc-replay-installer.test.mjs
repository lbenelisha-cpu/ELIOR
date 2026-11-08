import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {patchReplayCache} from '../scripts/patch-poc-replay-cache.mjs';
const root=new URL('../',import.meta.url),read=f=>fs.readFileSync(new URL(f,root),'utf8');
test('installer preserves runtime integrations, is repeatable and refuses unknown input before writing',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'poc-cache-test-'));
 try{
  const old=read('tests/fixtures/channel-poc-before-cache.js');
  const server=read('server.mjs').replace('\n    await new Promise(setImmediate); // Let quotes, protections and HTTP reads run between symbols.','')+'\n// installed custom integration\n';
  fs.writeFileSync(path.join(dir,'channel-poc-model.js'),old);fs.writeFileSync(path.join(dir,'server.mjs'),server);
  patchReplayCache(dir);const updated=fs.readFileSync(path.join(dir,'server.mjs'),'utf8');assert.ok(updated.endsWith('// installed custom integration\n'));
  patchReplayCache(dir);assert.equal(fs.readFileSync(path.join(dir,'server.mjs'),'utf8'),updated);
  fs.writeFileSync(path.join(dir,'channel-poc-model.js'),old+'// unknown');
  assert.throws(()=>patchReplayCache(dir),/Unrecognized POC/);assert.equal(fs.readFileSync(path.join(dir,'server.mjs'),'utf8'),updated);
  fs.writeFileSync(path.join(dir,'channel-poc-model.js'),old);fs.writeFileSync(path.join(dir,'server.mjs'),'unknown');
  assert.throws(()=>patchReplayCache(dir),/Unrecognized evaluation/);assert.equal(fs.readFileSync(path.join(dir,'channel-poc-model.js'),'utf8'),old);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('scanner yields to pending quote callbacks between symbols and preserves evaluation order',async()=>{
 const source=read('server.mjs'),start=source.indexOf('  for(const s of new Set([...SYMBOLS,...Object.keys(tradingPositions())])){');
 const loop=source.slice(start,source.indexOf('\n\n  const valid=',start)),events=[];
 const ctx=vm.createContext({SYMBOLS:['A','B','C'],tradingPositions:()=>({A:{}}),evals:[],setImmediate,evaluateSymbol:async s=>{events.push(s);if(s==='A')setImmediate(()=>events.push('quote'));return s;}});
 await vm.runInContext('(async()=>{'+loop+'})()',ctx);assert.deepEqual(events,['A','quote','B','C']);assert.deepEqual(Array.from(ctx.evals),['A','B','C']);
});
