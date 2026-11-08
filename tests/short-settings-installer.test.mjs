import {upgradePocFixture} from './helpers/upgrade-poc-fixture.mjs';
import {beforeParallelChecks,restorePreParallelLayout} from './helpers/pre-parallel-entry-layout.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {prePocFs as fs} from './helpers/pre-poc-source.mjs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {patchShortSettings} from '../scripts/patch-short-settings-exit.mjs';
import {patchChannelConsolidation} from '../scripts/patch-channel-consolidation.mjs';
const consolidationPatches=JSON.parse(fs.readFileSync(new URL('../scripts/channel-consolidation-patches.json',import.meta.url),'utf8'));
function beforeConsolidation(file,source){
 for(const p of consolidationPatches.filter(p=>p.file===file).reverse()){assert.equal(source.split(p.after).length,2);source=source.replace(p.after,p.before);}
 return source;
}
const patches=JSON.parse(fs.readFileSync(new URL('../scripts/short-settings-exit-patches.json',import.meta.url),'utf8'));
test('SHORT installer applies only recognized changes, preserves unrelated code, and is repeatable',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'short-settings-test-'));
 try{
  const expected=new Map();
  for(const file of new Set(patches.map(p=>p.file))){
   const next=beforeParallelChecks(file,fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'))+'\n// Preserve local deployment integration\n';
   expected.set(file,next);let old=beforeConsolidation(file,next);
   for(const p of patches.filter(p=>p.file===file).reverse()){
    assert.equal(old.split(p.after).length,2);old=old.replace(p.after,p.before);
   }
   fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),old);
  }
  patchShortSettings(dir,patches);patchShortSettings(dir,patches);
  patchChannelConsolidation(dir,consolidationPatches.filter(p=>fs.existsSync(path.join(dir,p.file))));
  for(const [file,next] of expected)assert.equal(fs.readFileSync(path.join(dir,file),'utf8'),next);
  const before=fs.readFileSync(path.join(dir,'server.mjs'),'utf8');
  assert.throws(()=>patchShortSettings(dir,[{file:'server.mjs',before:'// Preserve local deployment integration',after:'// staged'}, {file:'server.mjs',before:'missing anchor',after:'unknown replacement'}]),/Unrecognized/);
  assert.equal(fs.readFileSync(path.join(dir,'server.mjs'),'utf8'),before);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('settings endpoint blocks impossible SHORT targets for enabled, held and pending trades',()=>{
 const server=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const guard=server.split('\n').find(line=>line.includes('if(next.values.takeProfitPct>=100'));
 assert.ok(guard);
 for(const state of [{enabled:true},{positions:{ABC:{setup:{entryMode:'CHANNEL'}}}},{pending:{kind:'ENTRY'}},{rows:[{side:'SHORT',status:'WAITING'}]},{rows:[{side:'SHORT',status:'UNKNOWN'}]}]){
  const context={next:{values:{takeProfitPct:100}},futuresShort:{config:{enabled:state.enabled||false},state:{positions:state.positions||{},pending:state.pending||null}},pocEntries:{state:{rows:state.rows||[]}}};
  assert.throws(()=>vm.runInNewContext(guard,context),/SHORT_TP_BELOW_100_REQUIRED/);
  context.next.values.takeProfitPct=50;assert.doesNotThrow(()=>vm.runInNewContext(guard,context));
 }
 assert.doesNotThrow(()=>vm.runInNewContext(guard,{next:{values:{takeProfitPct:500}},futuresShort:{config:{enabled:false},state:{positions:{},pending:null}},pocEntries:{state:{rows:[]}}}));
});

test('staged tests support and preserve an installed runner with additional contract-price checks',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'short-contract-price-'));
 try{
  // Match the installer's staging boundary: installed runtime, reviewed tests/scripts.
  for(const name of ['lib','tests','scripts'])fs.cpSync(new URL('../'+name,import.meta.url),path.join(dir,name),{recursive:true});
  for(const name of ['server.mjs','binance-agent.js','regression-trend.js','parallel-channel.js'])fs.copyFileSync(new URL('../'+name,import.meta.url),path.join(dir,name));
  restorePreParallelLayout(dir);
  for(const file of new Set(patches.map(p=>p.file))){
   const target=path.join(dir,file);let source=beforeConsolidation(file,fs.readFileSync(target,'utf8'));
   for(const p of patches.filter(p=>p.file===file).reverse()){
    assert.equal(source.split(p.after).length,2);source=source.replace(p.after,p.before);
   }
   fs.writeFileSync(target,source);
  }
  // Compatibility fixture for the additional read seen in the VPS test failure;
  // it does not claim to reproduce every local change in the deployed runner.
  for(const file of new Set(consolidationPatches.map(p=>p.file))){
   if(patches.some(p=>p.file===file))continue;
   const target=path.join(dir,file);fs.writeFileSync(target,beforeConsolidation(file,fs.readFileSync(target,'utf8')));
  }
  const runnerPath=path.join(dir,'lib/futures-short-runner.mjs');
  const anchor=' async ensureAlgo(p,kind,price,allowConflictRecovery=true){';
  const contractCheck=`${anchor}
  const contract=await this.api.get('/fapi/v1/ticker/price',{symbol:p.symbol});
  if(contract.symbol!==p.symbol||!(Number(contract.price)>0)||this.now()-Number(contract.time)>10000)throw Error('CONTRACT_PRICE_UNVERIFIED');
  if(kind==='STOP_MARKET'?price<=Number(contract.price):price>=Number(contract.price))throw Error('CONTRACT_TRIGGER_ALREADY_REACHED');`;
  const installed=fs.readFileSync(runnerPath,'utf8');assert.equal(installed.split(anchor).length,2);
  fs.writeFileSync(runnerPath,installed.replace(anchor,contractCheck));
  patchShortSettings(dir,patches);patchShortSettings(dir,patches);
  patchChannelConsolidation(dir,consolidationPatches.filter(p=>fs.existsSync(path.join(dir,p.file))));
  assert.ok(fs.readFileSync(runnerPath,'utf8').includes(contractCheck),'retain deployed contract-price checks');
  upgradePocFixture(dir);
  const files=['futures-short.test.mjs','futures-short-recovery.test.mjs','futures-short-fill.test.mjs'].map(f=>path.join(dir,'tests',f));
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const run=()=>spawnSync(process.execPath,['--test','--test-reporter=tap',...files],{env,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
  const testPath=files[0],fixed=fs.readFileSync(testPath,'utf8');
  const route="  if(p==='/fapi/v1/ticker/price')return {symbol:q.symbol,price:quote.bidPrice,time:quote.time};";
  assert.equal(fixed.split(route).length,2);fs.writeFileSync(testPath,fixed.replace(route,''));
  const before=run();assert.ifError(before.error);assert.notEqual(before.status,0);
  assert.match(before.stdout+before.stderr,/Unexpected read \/fapi\/v1\/ticker\/price/);
  assert.match(before.stdout,/not ok \d+ - full entry installs verified close-only stop and TP/);
  fs.writeFileSync(testPath,fixed);
  const after=run();assert.ifError(after.error);assert.equal(after.status,0,after.stdout+after.stderr);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
