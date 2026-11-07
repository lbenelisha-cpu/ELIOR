import vm from 'node:vm';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {patchPocFastWatch} from '../scripts/patch-poc-fast-watch.mjs';
const patches=JSON.parse(fs.readFileSync(new URL('../scripts/poc-fast-watch-patches.json',import.meta.url),'utf8'));
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc-fast-install-'));
 for(const dir of ['lib','scripts','tests'])fs.cpSync(new URL('../'+dir,import.meta.url),path.join(root,dir),{recursive:true});
 for(const f of ['server.mjs','binance-agent.js','regression-trend.js','parallel-channel.js','channel-poc-model.js'])fs.copyFileSync(new URL('../'+f,import.meta.url),path.join(root,f));
 for(const p of [...patches].reverse()){
  const file=path.join(root,p.file);if(p.before===null){fs.rmSync(file);continue;}
  const text=fs.readFileSync(file,'utf8');
  if(p.scope){assert.equal(text.split(p.installedMarker).length,2,p.id);fs.writeFileSync(file,text.replace(p.installedMarker,''));}
  else{assert.equal(text.split(p.after).length,2,p.id);fs.writeFileSync(file,text.replace(p.after,p.before));}
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

const statusPatch=patches.find(p=>p.id==='server-7');
const scopeOf=source=>source.slice(source.indexOf(statusPatch.scope.start),source.indexOf(statusPatch.scope.end));
function publicStatus(source,{paused=false,channel=true}={}){
 const context={u:{pathname:'/api/binance-mode'},req:{method:'GET'},res:{},send:(_res,value)=>value,mode:'live',authorized:false,
 controlDevices:{enabled:true},HOURLY_TREND_RULE:{},BINANCE_ENTRY_RSI:{},ENTRY_POLICY_VERSION:'entry',BINANCE_CONFIRMED_POLICY:{},
 channelPrimary:{enabled:channel},independentEntry:{},marketNewsConfig:{},ATTENTION_POLICY:{},RESEARCH_PROTOCOL:{},ENTRY_COMPARISON_POLICY:{},EARLY_WAVE_POLICY:{},
 futuresShort:{config:{enabled:true},checkedAt:123},tradeSettings:{values:{stopLossPct:2},policyVersion:'settings'},TRAILING_EXIT_POLICY:'preserved-exits',
 POC_FAST_WATCH_POLICY:{version:'POC_FAST_WATCH_V1'},LIVE:true,AUTO_EXECUTION:true,tradeControl:{paused},LIVE_MAX_USDT:800,LIVE_MAX_POSITIONS:3,DEMO_TRADING:false,KEYS_CONFIGURED:true};
 return vm.runInNewContext('(function(){'+scopeOf(source)+'})()',context);
}
test('public fast-watch status tolerates optional, extended and reordered neighbour fields without altering them',()=>{
 const variants=[
  s=>s.replace("      pocPaper:{version:'POC_PAPER_V1',executionEnabled:false},\n",''),
  s=>s.replace('      pocTrading:{version:1},','      pocTrading:{version:2,localGuard:true},'),
  s=>s.replace('exitPolicy:TRAILING_EXIT_POLICY},','exitPolicy:TRAILING_EXIT_POLICY,ownerExtension:true},'),
  s=>s.replace('      shortTrading:',"      ownerStatus:{label:'preserve local integration'},\n      shortTrading:"),
  s=>s.replace('      pocTrading:{version:1},\n','').replace('      hourlyTrendFilter:', '      pocTrading:{version:1},\n      hourlyTrendFilter:')
 ];
 // These compatibility fixtures model independent local status integrations;
 // they are not presented as a copy of the user's unknown server source.
 for(const transform of variants){const root=fixture();try{
  const file=path.join(root,'server.mjs'),original=transform(fs.readFileSync(file,'utf8'));fs.writeFileSync(file,original);
  const before=scopeOf(original);patchPocFastWatch(root,patches);const once=fs.readFileSync(file,'utf8');
  assert.equal(scopeOf(once).replace(statusPatch.installedMarker,''),before,'preserve every existing status field byte for byte');
  const result=publicStatus(once),old=publicStatus(original);delete result.pocFastWatch;assert.equal(JSON.stringify(result),JSON.stringify(old));
  assert.equal(publicStatus(once).pocFastWatch.policy.version,'POC_FAST_WATCH_V1');assert.equal(publicStatus(once).pocFastWatch.enabled,true);
  assert.equal(publicStatus(once,{paused:true}).pocFastWatch.enabled,false);assert.equal(publicStatus(once,{channel:false}).pocFastWatch.enabled,false);
  patchPocFastWatch(root,patches);assert.equal(fs.readFileSync(file,'utf8'),once);
 }finally{fs.rmSync(root,{recursive:true,force:true});}}
});
test('the previous status matcher reproduces server-7 failure while the scoped insertion accepts the same layout',()=>{
 const root=fixture();try{
  const file=path.join(root,'server.mjs'),source=fs.readFileSync(file,'utf8').replace("      pocPaper:{version:'POC_PAPER_V1',executionEnabled:false},\n",'');fs.writeFileSync(file,source);
  const oldBefore="      shortTrading:authorized?futuresShort.status():{policy:futuresShort.config,enabled:futuresShort.config.enabled,checkedAt:futuresShort.checkedAt},\n      exitSettings:{...tradeSettings.values,policyVersion:tradeSettings.policyVersion,exitPolicy:TRAILING_EXIT_POLICY},\n      pocTrading:{version:1},\n      pocPaper:{version:'POC_PAPER_V1',executionEnabled:false},\n";
  const legacy={id:'server-7',file:'server.mjs',before:oldBefore,after:oldBefore.replace('      pocTrading:',statusPatch.installedMarker+'      pocTrading:')};
  assert.throws(()=>patchPocFastWatch(root,patches.map(p=>p.id==='server-7'?legacy:p)),/server-7.*no files changed/);assert.equal(fs.readFileSync(file,'utf8'),source);
  patchPocFastWatch(root,patches);assert.equal(publicStatus(fs.readFileSync(file,'utf8')).pocFastWatch.policy.version,'POC_FAST_WATCH_V1');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('an already installed original-layout status is recognized without relocation or duplication',()=>{
 const root=fixture();try{
  const file=path.join(root,'server.mjs'),source=fs.readFileSync(file,'utf8').replace('      pocTrading:',statusPatch.installedMarker+'      pocTrading:');fs.writeFileSync(file,source);
  patchPocFastWatch(root,patches);const once=fs.readFileSync(file,'utf8');assert.equal(scopeOf(once),scopeOf(source));patchPocFastWatch(root,patches);assert.equal(fs.readFileSync(file,'utf8'),once);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('missing or ambiguous status routes and edited or duplicate public fields abort every staged write',()=>{
 for(const kind of ['missing-get','missing-post','duplicate-get','duplicate-return','wrong-response','edited-field','duplicate-field','two-keys','quoted-field','computed-field']){
  const root=fixture();try{
   const file=path.join(root,'server.mjs');let source=fs.readFileSync(file,'utf8');
   if(kind==='missing-get')source=source.replace(statusPatch.scope.start,'  if(false){\n');
   if(kind==='missing-post')source=source.replace(statusPatch.scope.end,'  if(false){\n');
   if(kind==='duplicate-get')source+=statusPatch.scope.start;
   if(kind==='duplicate-return')source=source.replace(statusPatch.before,statusPatch.before+statusPatch.before);
   if(kind==='wrong-response')source=source.replace(statusPatch.before,'    return anotherResponse(res,{\n      mode,\n');
   if(kind==='edited-field')source=source.replace(statusPatch.before,statusPatch.before+statusPatch.installedMarker.replace("mode==='live'",'true'));
   if(kind==='duplicate-field')source=source.replace(statusPatch.before,statusPatch.before+statusPatch.installedMarker.repeat(2));
   if(kind==='quoted-field')source=source.replace(statusPatch.before,statusPatch.before+"      'pocFastWatch': {enabled:true},\n");
   if(kind==='computed-field')source=source.replace(statusPatch.before,statusPatch.before+"      ['pocFastWatch']: {enabled:true},\n");
   if(kind==='two-keys')source=source.replace(statusPatch.before,statusPatch.after+'      pocFastWatch: {enabled:true},\n');
   fs.writeFileSync(file,source);
   const before=new Map([...new Set(patches.map(p=>p.file))].map(f=>[f,fs.existsSync(path.join(root,f))?fs.readFileSync(path.join(root,f),'utf8'):null]));
   assert.throws(()=>patchPocFastWatch(root,patches),/server-7.*no files changed/);
   for(const [f,s]of before)assert.equal(fs.existsSync(path.join(root,f))?fs.readFileSync(path.join(root,f),'utf8'):null,s);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 }
});
