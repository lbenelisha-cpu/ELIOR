import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Source integration test for the original SHORT installer. Run this against
// the reviewed release, separately from installed-runtime trading tests.
test('targeted installer patches are idempotent and reject an unknown context without partial writes',async()=>{
 const {patchFutures}=await import('../scripts/patch-futures-short.mjs');
 const patches=JSON.parse(fs.readFileSync(new URL('../scripts/futures-short-patches.json',import.meta.url),'utf8'));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'short-patch-'));
 try{
  for(const file of ['server.mjs','binance-agent.js']){
   let source=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
   for(const p of patches.filter(x=>x.file===file).reverse())source=source.replace(p.after,p.before);
   fs.writeFileSync(path.join(dir,file),source);
  }
  patchFutures(dir,patches);const once=fs.readFileSync(path.join(dir,'server.mjs'),'utf8');patchFutures(dir,patches);assert.equal(fs.readFileSync(path.join(dir,'server.mjs'),'utf8'),once);
  const bad=patches.map(p=>({...p}));bad.push({file:'server.mjs',before:'nonexistent context',after:'unrecognized result'});assert.throws(()=>patchFutures(dir,bad),/Unrecognized/);assert.equal(fs.readFileSync(path.join(dir,'server.mjs'),'utf8'),once);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
