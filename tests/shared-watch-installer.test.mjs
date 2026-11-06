import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {patchSharedWatch} from '../scripts/patch-shared-market-watch.mjs';
const patches=JSON.parse(fs.readFileSync(new URL('../scripts/shared-market-watch-patches.json',import.meta.url),'utf8'));
test('shared watch stages local runtime changes atomically and retains local protection/server integrations',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shared-watch-install-'));
 try{
  for(const name of ['lib','scripts','tests'])fs.cpSync(new URL('../'+name,import.meta.url),path.join(root,name),{recursive:true});
  for(const name of ['server.mjs','binance-agent.js','regression-trend.js','parallel-channel.js'])fs.copyFileSync(new URL('../'+name,import.meta.url),path.join(root,name));
  for(const file of [...new Set(patches.map(p=>p.file))]){
   const filePath=path.join(root,file);let text=fs.readFileSync(filePath,'utf8');
   for(const patch of patches.filter(p=>p.file===file).reverse()){assert.ok(text.includes(patch.after));text=text.replace(patch.after,patch.before);}
   if(file==='server.mjs')text=text.replace('const server=http.createServer','const server = http.createServer');
   // The deployed SHORT protection path contains an extra last-trade quote read.
   if(file==='lib/futures-short-runner.mjs')text=text.replace(' async quote(symbol){',' async quote(symbol){\n  await this.api.get(\'/fapi/v1/ticker/price\',{symbol});');
   fs.writeFileSync(filePath,text);
  }
  const original=new Map([...new Set(patches.map(p=>p.file))].map(f=>[f,fs.readFileSync(path.join(root,f),'utf8')]));
  assert.throws(()=>patchSharedWatch(root,[...patches,{file:'server.mjs',before:'unknown anchor',after:'unknown replacement'}]),/no files changed/);
  for(const [file,text]of original)assert.equal(fs.readFileSync(path.join(root,file),'utf8'),text);
  patchSharedWatch(root,patches);const once=fs.readFileSync(path.join(root,'lib/futures-short-runner.mjs'),'utf8');patchSharedWatch(root,patches);assert.equal(fs.readFileSync(path.join(root,'lib/futures-short-runner.mjs'),'utf8'),once);
  assert.match(once,/ticker\/price/);assert.match(fs.readFileSync(path.join(root,'server.mjs'),'utf8'),/const server = http/);
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const names=['shared-market-watch','futures-short','futures-short-recovery','futures-short-fill','channel-consolidation','channel-consolidation-entry'];
  const run=spawnSync(process.execPath,['--test',...names.map(n=>path.join(root,'tests',n+'.test.mjs'))],{env,encoding:'utf8',timeout:30000,maxBuffer:2000000});
  assert.ifError(run.error);assert.equal(run.status,0,run.stdout+run.stderr);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
