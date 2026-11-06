import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {patchSharedWatch} from '../scripts/patch-shared-market-watch.mjs';
import {SharedMarketWatch,SHARED_WATCH_POLICY} from '../lib/shared-market-watch.mjs';
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

function oldRuntime(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shared-watch-layout-'));
 for(const file of [...new Set(patches.map(p=>p.file))]){
  let text=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
  for(const patch of patches.filter(p=>p.file===file).reverse()){
   assert.ok(text.includes(patch.after));text=text.replace(patch.after,patch.before);
  }
  fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),text);
 }
 return root;
}

test('shared watch initializes without the optional server POC hook and is idempotent in that layout',()=>{
 const root=oldRuntime();
 try{
  const init=patches.find(p=>p.id==='server-watch-initialization');
  // Use the real original SHORT constructor, not a fabricated alternate anchor.
  const original=JSON.parse(fs.readFileSync(new URL('../scripts/futures-short-patches.json',import.meta.url),'utf8'));
  const constructor=original.find(p=>p.after.startsWith('const futuresShort=new FuturesShortRunner')).after.split('\nconst server=')[0];
  const source=[patches.find(p=>p.id==='server-watch-import').before,
   'function marketAttentionSnapshot(){return attentionSnapshot({'+patches.find(p=>p.id==='server-attention-snapshot').before+'});}',
   constructor,patches.find(p=>p.id==='server-watch-timer').before].join('\n');
  assert.ok(!source.includes(init.before));
  const file=path.join(root,'server.mjs');fs.writeFileSync(file,source);
  patchSharedWatch(root,patches);const once=fs.readFileSync(file,'utf8');
  patchSharedWatch(root,patches);assert.equal(fs.readFileSync(file,'utf8'),once);
  assert.ok(!once.includes('pocEntries'));assert.ok(!once.includes('futuresShort.reserved='));
  const timers=[],state={closed:[],used:[],resumedAt:0};
  class FakeRunner{
   constructor(options){Object.assign(this,options);this.state=state;this.checks={};}
   watchEntryBlocker(){return 'FUTURES_ENTRIES_PAUSED';}
   status(){return {reason:'WAIT_NEW_SHORT_SIGNAL'};}
   cycle(){}
  }
  class FakeAPI{get(){throw Error('Unexpected network access during initialization');}}
  const context=vm.createContext({FuturesShortRunner:FakeRunner,FuturesShortAPI:FakeAPI,SharedMarketWatch,SHARED_WATCH_POLICY,
   BINANCE_API_KEY:'',BINANCE_API_SECRET:'',LIVE_LOG_FILE:'/unused',process:{env:{}},shortConfig:()=>({enabled:false}),
   tradeSettings:{values:{}},tradeControl:{paused:true,resumedAt:null},mode:'live',LIVE:true,AUTO_EXECUTION:true,
   channelPrimary:{enabled:true},liveManagedPositions:()=>({}),LIVE_MAX_POSITIONS:3,SYMBOLS:['GOOGLBUSDT'],
   getApiRestrictions:()=>{throw Error('Unexpected permission read');},attentionSnapshot:value=>value,
   setInterval:(fn,ms)=>{timers.push({fn,ms});return {unref(){}};}});
  vm.runInContext(once.replace(/^import .*;$/gm,'')+'\nglobalThis.result={futuresShort,watch:futuresWatch.snapshot(),attention:marketAttentionSnapshot()};',context);
  assert.equal(context.result.watch.policy.version,'SHARED_LONG_SHORT_WATCH_V1');
  assert.equal(context.result.watch.rows[0].spotSymbol,'GOOGLBUSDT');
  assert.equal(context.result.watch.entryBlocker,'FUTURES_ENTRIES_PAUSED');
  assert.equal(context.result.attention.sharedWatch.policy.version,'SHARED_LONG_SHORT_WATCH_V1');
  assert.equal(context.result.futuresShort.config.enabled,false);
  assert.deepEqual(timers.map(t=>t.ms),[2000,2000]);
  assert.equal(context.result.futuresShort.state,state);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('unknown or ambiguous server layouts report a patch ID and preserve every staged file',()=>{
 for(const layout of ['unknown','duplicate']){
  const root=oldRuntime();
  try{
   const init=patches.find(p=>p.id==='server-watch-initialization'),file=path.join(root,'server.mjs');
   let source=fs.readFileSync(file,'utf8');
   source=layout==='duplicate'?source+'\n'+init.before:source.replace(init.before,'').replace('permission:getApiRestrictions','permission:changedPermissions');
   fs.writeFileSync(file,source);
   const before=new Map([...new Set(patches.map(p=>p.file))].map(f=>[f,fs.readFileSync(path.join(root,f),'utf8')]));
   assert.throws(()=>patchSharedWatch(root,patches),new RegExp('server-watch-initialization; '+(layout==='duplicate'?'duplicate':'missing')+' anchor.*no files changed'));
   for(const [name,text]of before)assert.equal(fs.readFileSync(path.join(root,name),'utf8'),text);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 }
});
