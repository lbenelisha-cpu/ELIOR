import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {patchPocLifecycleReset} from '../scripts/patch-poc-lifecycle-reset.mjs';
test('lifecycle installer accepts reviewed runtime, is idempotent and leaves execution code and ledger untouched',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc-reset-'));
 try{
  fs.copyFileSync(new URL('./fixtures/channel-poc-before-lifecycle.js',import.meta.url),path.join(root,'channel-poc-model.js'));
  const patches=JSON.parse(fs.readFileSync(new URL('../scripts/poc-lifecycle-patches.json',import.meta.url),'utf8'));
  const files=new Set(patches.map(p=>p.file));
  for(const file of files){let source=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');for(const p of patches.filter(p=>p.file===file).reverse())source=source.replace(p.after,p.before);fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),source+'\n// custom runtime retained');}
  fs.writeFileSync(path.join(root,'ledger.json'),'open position and receipts');
  fs.writeFileSync(path.join(root,'lib/colmex-auto-runner.mjs'),'unrelated Colmex runtime');
  patchPocLifecycleReset(root,undefined,{binanceOnly:true});patchPocLifecycleReset(root,undefined,{binanceOnly:true});
  assert.equal(fs.readFileSync(path.join(root,'lib/colmex-auto-runner.mjs'),'utf8'),'unrelated Colmex runtime');
  fs.copyFileSync(new URL('./fixtures/channel-poc-before-fresh-conditions.js',import.meta.url),path.join(root,'channel-poc-model.js'));
  patchPocLifecycleReset(root,undefined,{binanceOnly:true});
  assert.equal(fs.readFileSync(path.join(root,'channel-poc-model.js'),'utf8'),fs.readFileSync(new URL('../channel-poc-model.js',import.meta.url),'utf8'));
  assert.ok(fs.readFileSync(path.join(root,'server.mjs'),'utf8').endsWith('// custom runtime retained'));assert.equal(fs.readFileSync(path.join(root,'ledger.json'),'utf8'),'open position and receipts');
  fs.appendFileSync(path.join(root,'channel-poc-model.js'),'\nunknown edit');const edited=fs.readFileSync(path.join(root,'channel-poc-model.js'),'utf8');
  assert.throws(()=>patchPocLifecycleReset(root),/Unrecognized/);assert.equal(fs.readFileSync(path.join(root,'channel-poc-model.js'),'utf8'),edited);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
