import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {patchAttention} from '../scripts/patch-market-attention.mjs';
// Historical patch reconstruction uses the reviewed release, not a deployed
// server whose unrelated local integrations must be retained.
test('installer is atomic and idempotent while preserving unrelated production edits',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'attention-patch-'));
 try{
  const patches=JSON.parse(fs.readFileSync(new URL('../scripts/market-attention-patches.json',import.meta.url)));
  for(const file of ['server.mjs','binance-agent.html']){
   let s=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
   s=s.replaceAll(',positionOpen:!!(tradingPositions()[symbol]||futuresShort.state.positions[symbol])','');
   // Reconstruct the original installer's source context before the later shared-watch integration.
   const later=JSON.parse(fs.readFileSync(new URL('../scripts/shared-market-watch-patches.json',import.meta.url),'utf8'));
   for(const p of later.filter(p=>p.file===file).reverse())s=s.replace(p.after,p.before);
   for(const p of patches.filter(p=>p.file===file).reverse())s=s.replace(p.after,p.before);
   fs.writeFileSync(path.join(root,file),s+'\n// unrelated production edit\n');
  }
  patchAttention(root,patches);const first=fs.readFileSync(path.join(root,'server.mjs'),'utf8');patchAttention(root,patches);assert.equal(fs.readFileSync(path.join(root,'server.mjs'),'utf8'),first);assert.match(first,/unrelated production edit/);
  assert.throws(()=>patchAttention(root,[{file:'server.mjs',before:'// unrelated production edit',after:'// changed'},{file:'binance-agent.html',before:'nonexistent',after:'nonexistent replacement sentinel'}]),/no files changed/);assert.equal(fs.readFileSync(path.join(root,'server.mjs'),'utf8'),first);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
