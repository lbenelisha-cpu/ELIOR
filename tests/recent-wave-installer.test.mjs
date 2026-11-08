import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {patchRecentWavePoc,recentWaveFiles} from '../scripts/patch-recent-wave-poc.mjs';
const manifest=JSON.parse(fs.readFileSync(new URL('../scripts/recent-wave-poc-patches.json',import.meta.url),'utf8')),fast=JSON.parse(fs.readFileSync(new URL('../scripts/poc-fast-watch-patches.json',import.meta.url),'utf8'));
function fixture(preFast){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'recent-wave-test-'));
 for(const dir of ['lib','scripts','tests'])fs.cpSync(new URL('../'+dir,import.meta.url),path.join(root,dir),{recursive:true});
 for(const file of new Set([...recentWaveFiles,'binance-agent.js','tradingview-exit-snapshot.js','regression-trend.js','parallel-channel.js'])){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.copyFileSync(new URL('../'+file,import.meta.url),path.join(root,file));}
 for(const p of manifest){const file=path.join(root,p.file),s=fs.readFileSync(file,'utf8');fs.writeFileSync(file,p.fragment?s.replace(p.after,p.before):p.before);}
 if(preFast)for(const p of [...fast].reverse()){
  const file=path.join(root,p.file),s=fs.readFileSync(file,'utf8');
  if(p.before===null){fs.rmSync(file);continue;}
  fs.writeFileSync(file,p.scope?s.replace(p.installedMarker,''):s.replace(p.after,p.before));
 }
 // A missing new helper is staged from release by the shell installer.
 if(!fs.existsSync(path.join(root,'lib/poc-fast-watch.mjs')))fs.writeFileSync(path.join(root,'lib/poc-fast-watch.mjs'),manifest.find(p=>p.file==='lib/poc-fast-watch.mjs').after);
 return root;
}
for(const preFast of [true,false])test('recent-wave installer accepts '+(preFast?'pre-fast-watch':'fast-watch')+' runtime, retains local exits and is repeatable',()=>{
 const root=fixture(preFast);try{
  const server=path.join(root,'server.mjs');let s=fs.readFileSync(server,'utf8');const start=s.indexOf('async function executeLiveCycle('),end=s.indexOf('async function getLiveAccountSnapshot(',start);
  const deployed=fs.readFileSync(new URL('./fixtures/binance-live-cycle-deployed-20261106.txt',import.meta.url),'utf8');
  fs.writeFileSync(server,s.slice(0,start)+deployed+s.slice(end));
  const runner=path.join(root,'lib/futures-short-runner.mjs'),check="\n  const q=await this.api.get('/fapi/v1/ticker/price',{symbol:p.symbol});\n  if(!(Number(q.price)>0))throw Error('CONTRACT_PRICE_UNVERIFIED');";
  fs.writeFileSync(runner,fs.readFileSync(runner,'utf8').replace(' async ensureAlgo(p,kind,price,allowConflictRecovery=true){',' async ensureAlgo(p,kind,price,allowConflictRecovery=true){'+check));
  fs.writeFileSync(path.join(root,'positions.json'),'{"existing":"untouched"}');
  patchRecentWavePoc(root);assert.ok(fs.readFileSync(server,'utf8').includes(deployed));assert.ok(fs.readFileSync(runner,'utf8').includes(check));
  const once=recentWaveFiles.map(f=>fs.readFileSync(path.join(root,f),'utf8'));patchRecentWavePoc(root);assert.deepEqual(recentWaveFiles.map(f=>fs.readFileSync(path.join(root,f),'utf8')),once);assert.equal(fs.readFileSync(path.join(root,'positions.json'),'utf8'),'{"existing":"untouched"}');
  const env={...process.env};delete env.NODE_TEST_CONTEXT;const r=spawnSync(process.execPath,[path.join(root,'scripts/test-recent-wave-runtime.mjs'),root],{env,encoding:'utf8',timeout:45000,maxBuffer:2000000});assert.ifError(r.error);assert.equal(r.status,0,r.stdout+r.stderr);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('unknown model, duplicate server hook or edited helper prevents every staged write',()=>{
 for(const file of ['channel-poc-model.js','lib/channel-poc-entry.mjs','server.mjs']){const root=fixture(true);try{
  const target=path.join(root,file);fs.appendFileSync(target,file==='server.mjs'?fast.find(p=>p.id==='server-6').before:'\n// unknown edit');
  const before=recentWaveFiles.map(f=>fs.existsSync(path.join(root,f))?fs.readFileSync(path.join(root,f),'utf8'):null);
  assert.throws(()=>patchRecentWavePoc(root),/no files changed/);assert.deepEqual(recentWaveFiles.map(f=>fs.existsSync(path.join(root,f))?fs.readFileSync(path.join(root,f),'utf8'):null),before);
 }finally{fs.rmSync(root,{recursive:true,force:true});}}
});
