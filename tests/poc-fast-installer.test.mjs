import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {patchPocFastWatch} from '../scripts/patch-poc-fast-watch.mjs';
const patches=JSON.parse(fs.readFileSync(new URL('../scripts/poc-fast-watch-patches.json',import.meta.url),'utf8'));
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc-fast-install-'));
 for(const dir of ['lib','scripts','tests'])fs.cpSync(new URL('../'+dir,import.meta.url),path.join(root,dir),{recursive:true});
 for(const f of ['server.mjs','binance-agent.js','regression-trend.js','parallel-channel.js','channel-poc-model.js'])fs.copyFileSync(new URL('../'+f,import.meta.url),path.join(root,f));
 for(const p of [...patches].reverse()){
  const file=path.join(root,p.file);if(p.before===null){fs.rmSync(file);continue;}
  const text=fs.readFileSync(file,'utf8');assert.equal(text.split(p.after).length,2,p.id);fs.writeFileSync(file,text.replace(p.after,p.before));
 }
 return root;
}
test('fast-watch installer is idempotent, retains the deployed Spot cycle and additional native SHORT price checks',()=>{
 const root=fixture();try{
  const server=path.join(root,'server.mjs'),src=fs.readFileSync(server,'utf8'),start=src.indexOf('async function executeLiveCycle('),end=src.indexOf('async function getLiveAccountSnapshot(',start);
  const installed=fs.readFileSync(new URL('./fixtures/binance-live-cycle-deployed-20261106.txt',import.meta.url),'utf8');fs.writeFileSync(server,src.slice(0,start)+installed+src.slice(end));
  const runner=path.join(root,'lib/futures-short-runner.mjs'),anchor=' async ensureAlgo(p,kind,price){';
  const check="\n  const contract=await this.api.get('/fapi/v1/ticker/price',{symbol:p.symbol});\n  if(contract.symbol!==p.symbol||!(Number(contract.price)>0)||this.now()-Number(contract.time)>10000)throw Error('CONTRACT_PRICE_UNVERIFIED');\n  if(kind==='STOP_MARKET'?price<=Number(contract.price):price>=Number(contract.price))throw Error('CONTRACT_TRIGGER_ALREADY_REACHED');";
  fs.writeFileSync(runner,fs.readFileSync(runner,'utf8').replace(anchor,anchor+check));
  patchPocFastWatch(root,patches);assert.ok(fs.readFileSync(server,'utf8').includes(installed));assert.ok(fs.readFileSync(runner,'utf8').includes(check));
  const saved=new Map([...new Set(patches.map(p=>p.file))].map(f=>[f,fs.readFileSync(path.join(root,f),'utf8')]));patchPocFastWatch(root,patches);for(const [f,s]of saved)assert.equal(fs.readFileSync(path.join(root,f),'utf8'),s);
  const env={...process.env};delete env.NODE_TEST_CONTEXT;const r=spawnSync(process.execPath,[path.join(root,'scripts/test-poc-fast-runtime.mjs'),root],{env,encoding:'utf8',timeout:30000,maxBuffer:2000000});assert.ifError(r.error);assert.equal(r.status,0,r.stdout+r.stderr);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('unknown or duplicate integration and edited helper abort before writing any staged file',()=>{
 for(const kind of ['unknown','duplicate','helper']){
  const root=fixture();try{
   const p=patches.find(p=>p.id==='futures-short-runner-3'),file=path.join(root,p.file),s=fs.readFileSync(file,'utf8');
   if(kind==='unknown')fs.writeFileSync(file,s.replace(p.before,'// changed scheduler'));
   if(kind==='duplicate')fs.appendFileSync(file,p.before);
   if(kind==='helper')fs.writeFileSync(path.join(root,'lib/poc-fast-watch.mjs'),'// unreviewed helper');
   const before=new Map([...new Set(patches.map(p=>p.file))].map(f=>[f,fs.existsSync(path.join(root,f))?fs.readFileSync(path.join(root,f),'utf8'):null]));
   assert.throws(()=>patchPocFastWatch(root,patches),/no files changed/);
   for(const [f,s]of before)assert.equal(fs.existsSync(path.join(root,f))?fs.readFileSync(path.join(root,f),'utf8'):null,s);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 }
});
