import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
import {patchDynamicShort,dynamicShortPatches} from '../scripts/patch-dynamic-short.mjs';
const source=new URL('../',import.meta.url);
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dynamic-short-'));
 for(const name of ['lib','scripts','tests'])fs.cpSync(new URL(name,source),path.join(root,name),{recursive:true});
 for(const name of fs.readdirSync(source).filter(n=>/\.(m?js|json)$/.test(n)))fs.copyFileSync(new URL(name,source),path.join(root,name));
 for(const p of [...dynamicShortPatches].reverse()){
  const target=path.join(root,p.file),s=fs.readFileSync(target,'utf8');assert.equal(s.split(p.after).length,2,p.id);fs.writeFileSync(target,s.replace(p.after,p.before));
 }
 return root;
}
function snapshot(root){return [...new Set(dynamicShortPatches.map(p=>p.file))].map(f=>fs.readFileSync(path.join(root,f),'utf8'));}
test('dynamic installer preserves local native checks, all journals and exits, repeats safely, and runs execution tests',()=>{
 const root=fixture();try{
  const runner=path.join(root,'lib/futures-short-runner.mjs');
  fs.writeFileSync(runner,fs.readFileSync(runner,'utf8').replace(' async quote(symbol){'," async quote(symbol){\n  await this.api.get('/fapi/v1/ticker/price',{symbol});"));
  fs.appendFileSync(path.join(root,'server.mjs'),'\n// Owner monitoring integration\n');
  const journal='{"pending":null,"halt":"FUTURES_API_-2011","closed":[{"symbol":"ABCUSDT"}]}';fs.writeFileSync(path.join(root,'journal.json'),journal);
  patchDynamicShort(root);const once=snapshot(root);patchDynamicShort(root);assert.deepEqual(snapshot(root),once);
  assert.match(fs.readFileSync(runner,'utf8'),/ticker\/price/);assert.match(fs.readFileSync(path.join(root,'server.mjs'),'utf8'),/Owner monitoring/);
  assert.equal(fs.readFileSync(path.join(root,'journal.json'),'utf8'),journal);
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const r=spawnSync(process.execPath,['--test',...['futures-short','binance-poc','futures-short-recovery','futures-short-fill'].map(n=>path.join(root,'tests',n+'.test.mjs'))],{env,encoding:'utf8',timeout:60000,maxBuffer:2000000});assert.ifError(r.error);assert.equal(r.status,0,r.stdout+r.stderr);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('unknown, duplicate and mixed allocations abort all staged writes',()=>{
 for(const kind of ['unknown','duplicate','mixed']){
  const root=fixture();try{
   const p=dynamicShortPatches.find(p=>p.file==='lib/futures-short-runner.mjs'),f=path.join(root,p.file),s=fs.readFileSync(f,'utf8');
   fs.writeFileSync(f,kind==='unknown'?s.replace(p.before,'unreviewed allocation'):s+'\n'+(kind==='duplicate'?p.before:p.after));const before=snapshot(root);
   assert.throws(()=>patchDynamicShort(root),/no files changed/);assert.deepEqual(snapshot(root),before);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 }
});
test('installer checks pending orders before and after service stop, backs up code, and verifies running policy',()=>{
 const f=new URL('../scripts/install-dynamic-short.sh',import.meta.url),s=fs.readFileSync(f,'utf8');assert.equal(spawnSync('bash',['-n',f.pathname]).status,0);
 assert.equal(s.split('assertNoPendingEntry({spotPending,journal});').length,3);assert.match(s,/trap rollback ERR/);assert.match(s,/FUTURES_WALLET_HALF_V1/);assert.doesNotMatch(s,/git (reset|pull|checkout)|\/fapi\/v1\/order/);
});
