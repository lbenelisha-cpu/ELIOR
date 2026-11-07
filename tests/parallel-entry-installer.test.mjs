import test from 'node:test';
import assert from 'node:assert/strict';
import {prePocFs as fs} from './helpers/pre-poc-source.mjs';
import path from 'node:path';
import os from 'node:os';
import {patchParallelChecks} from '../scripts/patch-parallel-entry-checks.mjs';
const patches=JSON.parse(fs.readFileSync(new URL('../scripts/parallel-entry-checks-patches.json',import.meta.url),'utf8'));
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'parallel-entry-'));
 for(const file of new Set(patches.filter(p=>p.before!==null).map(p=>p.file))){
  let text=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
  for(const p of patches.filter(p=>p.file===file).reverse()){assert.equal(text.split(p.after).length,2,p.id);text=text.replace(p.after,p.before);}
  fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),text+'\n// retained local integration\n');
 }
 return root;
}
test('parallel installer stages every change atomically, is idempotent and retains local integrations',()=>{
 const root=fixture();try{
  const files=[...new Set(patches.filter(p=>p.before!==null).map(p=>p.file))],original=Object.fromEntries(files.map(f=>[f,fs.readFileSync(path.join(root,f),'utf8')]));
  assert.throws(()=>patchParallelChecks(root,[...patches,{id:'unknown',file:'server.mjs',before:'unknown-code',after:'new-code'}]),/no files changed/);
  for(const file of files)assert.equal(fs.readFileSync(path.join(root,file),'utf8'),original[file]);
  assert.equal(fs.existsSync(path.join(root,'lib/channel-condition-report.mjs')),false);
  patchParallelChecks(root,patches);
  for(const file of files)assert.equal(fs.readFileSync(path.join(root,file),'utf8'),fs.readFileSync(new URL('../'+file,import.meta.url),'utf8')+'\n// retained local integration\n');
  const once=Object.fromEntries([...files,'lib/channel-condition-report.mjs'].map(f=>[f,fs.readFileSync(path.join(root,f),'utf8')]));
  patchParallelChecks(root,patches);for(const [file,text]of Object.entries(once))assert.equal(fs.readFileSync(path.join(root,file),'utf8'),text);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('ambiguous, modified policy and unexpected helper contexts abort without partial writes',()=>{
 for(const type of ['duplicate','modified','helper']){
  const root=fixture();try{
   const p=patches.find(p=>p.file==='lib/futures-short-policy.mjs'),file=path.join(root,p.file);
   if(type==='duplicate')fs.appendFileSync(file,p.before);
   if(type==='modified')fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(p.before,p.before.replace('volumeRatio>=','volumeRatio >='))+'\n');
   // Ensure this case really changes a reviewed evaluator context.
   if(type==='modified')fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('const no=reason=>','const no = reason=>'));
   if(type==='helper')fs.writeFileSync(path.join(root,'lib/channel-condition-report.mjs'),'unreviewed helper');
   const files=[...new Set(patches.map(p=>p.file))].filter(f=>fs.existsSync(path.join(root,f))),before=Object.fromEntries(files.map(f=>[f,fs.readFileSync(path.join(root,f),'utf8')]));
   assert.throws(()=>patchParallelChecks(root,patches),/no files changed/);
   for(const [f,text]of Object.entries(before))assert.equal(fs.readFileSync(path.join(root,f),'utf8'),text);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 }
});

// This is the actual Binance-only intrabar module from ELIOR commit
// 5381d2cc0db960c8faedef38eb9fb55e8c95b501, before the separate Colmex changes.
// Reproduce the subsequently installed settings/consolidation updates with their
// historical manifests, rather than deriving the fixture from today's template.
function historicalBinancePolicy(){
 let source=fs.readFileSync(new URL('./fixtures/futures-short-intrabar-5381d2c.txt',import.meta.url),'utf8');
 for(const name of ['short-settings-exit','channel-consolidation']){
  const historical=JSON.parse(fs.readFileSync(new URL('../scripts/'+name+'-patches.json',import.meta.url),'utf8'));
  for(const p of historical.filter(p=>p.file==='lib/futures-short-policy.mjs')){
   assert.equal(source.split(p.before).length,2,name);source=source.replace(p.before,p.after);
  }
 }
 return source;
}
const shortBody=source=>source.slice(source.indexOf('export function shortSignal('),source.indexOf('// Cumulative live volume'));
test('published Binance-only intrabar plus settings/consolidation installs independent checks and retains exits',async()=>{
 const {binanceOnlyShort}=await import('../scripts/parallel-entry-layouts.mjs');
 const root=fixture();try{
  const previous=historicalBinancePolicy(),patch=patches.find(p=>p.id==='independent-short');
  assert.equal(shortBody(previous),binanceOnlyShort(patch.before),'historical published code matches the reviewed alternate input');
  const file=path.join(root,'lib/futures-short-policy.mjs');
  fs.writeFileSync(file,previous+'\n// Preserve deployed exit integration\n');
  const server=path.join(root,'server.mjs'),serverBefore=fs.readFileSync(server,'utf8');
  // Exact source provided from the VPS, including both exit-wrapper calls and
  // the POC entry guard. Do not synthesize just one of its local dependencies.
  const deployedCycle=fs.readFileSync(new URL('./fixtures/binance-live-cycle-deployed-20261106.txt',import.meta.url),'utf8');
  const start=serverBefore.indexOf('async function executeLiveCycle('),end=serverBefore.indexOf('async function getLiveAccountSnapshot(',start);
  assert.ok(start>=0&&end>start);
  fs.writeFileSync(server,serverBefore.slice(0,start)+deployedCycle+serverBefore.slice(end));
  patchParallelChecks(root,patches);const next=fs.readFileSync(file,'utf8');
  const serverAfter=fs.readFileSync(server,'utf8'),cycleStart=serverAfter.indexOf('async function executeLiveCycle(');
  assert.equal(serverAfter.slice(cycleStart,serverAfter.indexOf('async function getLiveAccountSnapshot(',cycleStart)),deployedCycle);
  assert.equal(shortBody(next),binanceOnlyShort(patch.after));
  assert.equal(next.slice(next.indexOf('// Cumulative live volume')),previous.slice(previous.indexOf('// Cumulative live volume'))+'\n// Preserve deployed exit integration\n');
  assert.match(next,/conditionReportVersion:CHANNEL_CONDITIONS_VERSION/);assert.doesNotMatch(next,/colmex-market-hours|stockSessionGap|regularSession/);
  patchParallelChecks(root,patches);assert.equal(fs.readFileSync(file,'utf8'),next);assert.equal(fs.readFileSync(server,'utf8'),serverAfter);
  // Supply the unchanged dependencies, and exercise the resulting installed files.
  for(const name of ['lib','tests','scripts'])fs.cpSync(new URL('../'+name,import.meta.url),path.join(root,name),{recursive:true,force:false});
  for(const entry of fs.readdirSync(new URL('../',import.meta.url),{withFileTypes:true})){
   if(entry.isFile()&&!entry.name.startsWith('.')&&!fs.existsSync(path.join(root,entry.name)))
    fs.copyFileSync(new URL('../'+entry.name,import.meta.url),path.join(root,entry.name));
  }
  const {spawnSync}=await import('node:child_process'),env={...process.env};delete env.NODE_TEST_CONTEXT;
  // Run exactly the same complete suite as the VPS installer. A smaller subset
  // previously missed local hook and historical-installer fixture mismatches.
  const {patchChannelPoc}=await import('../scripts/patch-channel-poc.mjs'),{prepareLegacyPocHelpers}=await import('./helpers/upgrade-poc-fixture.mjs');const poc=JSON.parse(fs.readFileSync(new URL('../scripts/channel-poc-patches.json',import.meta.url),'utf8'));prepareLegacyPocHelpers(root,poc);patchChannelPoc(root,poc);
  const run=spawnSync(process.execPath,[path.join(root,'scripts/test-channel-poc-runtime.mjs'),root],{env,encoding:'utf8',timeout:120000,maxBuffer:2000000});
  assert.ifError(run.error);assert.equal(run.status,0,run.stdout+run.stderr);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Binance-only layouts with changed entry guards or mixed evaluators are refused atomically',()=>{
 for(const mutation of ['guard','duplicate','mixed','import']){
  const root=fixture();try{
   let source=historicalBinancePolicy();
   if(mutation==='guard')source=source.replace('volumeRatio<1.5','volumeRatio<1.1');
   if(mutation==='duplicate')source+=shortBody(source);
   if(mutation==='mixed')source+=patches.find(p=>p.id==='independent-short').after;
   if(mutation==='import')source=source.replace("import {validChannelLiveBar} from './channel-live-bar.mjs';","import {validChannelLiveBar} from './custom-live-bar.mjs';");
   fs.writeFileSync(path.join(root,'lib/futures-short-policy.mjs'),source);
   const files=[...new Set(patches.filter(p=>p.before!==null).map(p=>p.file))],before=files.map(f=>[f,fs.readFileSync(path.join(root,f),'utf8')]);
   assert.throws(()=>patchParallelChecks(root,patches),/no files changed/);
   for(const [file,original]of before)assert.equal(fs.readFileSync(path.join(root,file),'utf8'),original);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 }
});
