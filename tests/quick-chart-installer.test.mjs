import test from 'node:test';import assert from 'node:assert/strict';import {preDynamicFs as fs} from './helpers/pre-dynamic-source.mjs';import os from 'node:os';import path from 'node:path';
import {patchQuickTrades} from '../scripts/patch-quick-chart-trades.mjs';
test('quick trade installer preserves unrelated installed guards and fails atomically',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quick-install-'));fs.mkdirSync(path.join(dir,'lib'));
 const patches=JSON.parse(fs.readFileSync(new URL('../scripts/quick-chart-trades-patches.json',import.meta.url),'utf8'));
 try{
  for(const file of ['server.mjs','lib/futures-short-runner.mjs']){
   let source=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
   for(const p of patches.filter(p=>p.file===file).reverse()){assert.equal(source.split(p.after).length,2);source=source.replace(p.after,p.before);}
   fs.writeFileSync(path.join(dir,file),source+'\n// retained installed guard\n');
  }
  const original=fs.readFileSync(path.join(dir,'server.mjs'),'utf8');
  patchQuickTrades(dir);const a=fs.readFileSync(path.join(dir,'server.mjs'),'utf8'),b=fs.readFileSync(path.join(dir,'lib/futures-short-runner.mjs'),'utf8');
  assert.ok(b.includes('// retained installed guard'));patchQuickTrades(dir);assert.equal(fs.readFileSync(path.join(dir,'server.mjs'),'utf8'),a);
  fs.writeFileSync(path.join(dir,'server.mjs'),original);fs.writeFileSync(path.join(dir,'lib/futures-short-runner.mjs'),'unknown');assert.throws(()=>patchQuickTrades(dir),/no files changed/);assert.equal(fs.readFileSync(path.join(dir,'server.mjs'),'utf8'),original);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
