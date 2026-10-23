import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compactDecisionHistory,retainDecision} from '../lib/decision-chart-history.mjs';
import {createDecisionHistoryWriter} from '../lib/decision-history-writer.mjs';
test('historical RSI arrays are removed without altering live execution inputs or pivots',()=>{
 const row={at:new Date().toISOString(),checks:7,setup:{rsiCloses:Array(2016).fill(123),entryRsi:25,initialPeak:{price:125,time:1},patternId:'spring'}};
 const history=compactDecisionHistory({BTCUSDT:[row]});
 assert.equal(row.setup.rsiCloses.length,2016);
 assert.equal(history.BTCUSDT[0].setup.rsiCloses,undefined);
 assert.deepEqual(history.BTCUSDT[0].setup.initialPeak,row.setup.initialPeak);
 assert.equal(history.BTCUSDT[0].checks,7);
 assert.equal(retainDecision([],row)[0].setup.rsiCloses,undefined);
 assert.ok(JSON.stringify(history).length<JSON.stringify({BTCUSDT:[row]}).length/10);
});
test('coalesced atomic saves preserve all symbols and updates made during a write',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'levi-history-'));const file=join(dir,'history.json');
 try{
  let rows={BTCUSDT:[{at:'a'}],ETHUSDT:[{at:'b'}]};
  const writer=createDecisionHistoryWriter({file,snapshot:()=>({...rows}),delayMs:60000});
  writer.schedule();writer.schedule();const first=writer.flush();
  rows={BTCUSDT:[{at:'new'}],ETHUSDT:rows.ETHUSDT};writer.schedule();
  await first;await writer.flush();assert.deepEqual(JSON.parse(await readFile(file,'utf8')),rows);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('failed persistence keeps the previous file and retries pending data',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'levi-history-'));const file=join(dir,'history.json');let errors=0;
 try{
  await writeFile(file,'{"old":[]}');let rows={BTCUSDT:[1n]};
  const writer=createDecisionHistoryWriter({file,snapshot:()=>rows,onError:()=>errors++,delayMs:60000});
  writer.schedule();await writer.flush();assert.equal(errors,1);assert.equal(await readFile(file,'utf8'),'{"old":[]}');
  rows={BTCUSDT:[1]};await writer.flush();assert.deepEqual(JSON.parse(await readFile(file,'utf8')),rows);
 }finally{await rm(dir,{recursive:true,force:true});}
});
