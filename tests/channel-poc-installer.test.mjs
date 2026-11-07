import {prepareLegacyPocHelpers} from './helpers/upgrade-poc-fixture.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import vm from 'node:vm';import {spawnSync} from 'node:child_process';
import {patchChannelPoc} from '../scripts/patch-channel-poc.mjs';
const base=new URL('../',import.meta.url),patches=JSON.parse(fs.readFileSync(new URL('../scripts/channel-poc-patches.json',import.meta.url),'utf8'));
function fixture(historical=false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc-installer-'));
 for(const dir of ['lib','scripts','tests'])fs.cpSync(new URL('../'+dir,import.meta.url),path.join(root,dir),{recursive:true});
 for(const f of fs.readdirSync(base,{withFileTypes:true}))if(f.isFile()&&!f.name.startsWith('.'))fs.copyFileSync(new URL('../'+f.name,import.meta.url),path.join(root,f.name));
 prepareLegacyPocHelpers(root,patches,{installedRisk:true});
 for(const p of [...patches].reverse()){
  const file=path.join(root,p.file);if(p.before===null){fs.rmSync(file,{force:true});continue;}
  const s=fs.readFileSync(file,'utf8');assert.equal(s.split(p.after).length,2,p.id);fs.writeFileSync(file,s.replace(p.after,p.before));
 }
 if(historical)fs.copyFileSync(new URL('./fixtures/pre-poc/'+(historical==='deployed'?'futures-short-deployed-20261107.mjs':'futures-short-binance-parallel.mjs'),import.meta.url),path.join(root,'lib/futures-short-policy.mjs'));
 fs.appendFileSync(path.join(root,'lib/futures-short-policy.mjs'),'\n// Deployed exit hook retained\n');
 const server=path.join(root,'server.mjs'),s=fs.readFileSync(server,'utf8'),start=s.indexOf('async function executeLiveCycle('),end=s.indexOf('async function getLiveAccountSnapshot(',start);
 const cycle=fs.readFileSync(new URL('./fixtures/binance-live-cycle-deployed-20261106.txt',import.meta.url),'utf8');fs.writeFileSync(server,s.slice(0,start)+cycle+s.slice(end));
 return root;
}
const configSource=s=>s.slice(s.indexOf('export function shortConfig('),s.indexOf('export function shortSignal('));
const equityRiskFixture=new URL('./fixtures/pre-poc/lib/confirmed-risk-sizing-equity-v1.mjs',import.meta.url);
test('V1 equal-equity risk reproduces the released failure and upgrades without changing allocation',async()=>{
 const root=fixture('deployed');try{
  const file=path.join(root,'lib/confirmed-risk-sizing.mjs'),before=fs.readFileSync(equityRiskFixture,'utf8');
  fs.writeFileSync(file,before);
  const files=[...new Set(patches.map(p=>p.file))],snapshot=files.map(f=>[f,fs.existsSync(path.join(root,f))?fs.readFileSync(path.join(root,f),'utf8'):null]);
  const released=patches.map(p=>p.file==='lib/confirmed-risk-sizing.mjs'?{...p,alternatives:[]}:p);
  assert.throws(()=>patchChannelPoc(root,released),/integration-confirmed-risk-sizing.mjs-1.*no files changed/);
  for(const [f,s]of snapshot)assert.equal(fs.existsSync(path.join(root,f))?fs.readFileSync(path.join(root,f),'utf8'):null,s);
  patchChannelPoc(root,patches);
  const after=fs.readFileSync(file,'utf8');
  assert.equal(after,before.replace("input?.source==='CHANNEL_POC_RETEST_V1'","['CHANNEL_POC_RETEST_V1','CHANNEL_POC_RETEST_V2'].includes(input?.source)"));
  patchChannelPoc(root,patches);assert.equal(fs.readFileSync(file,'utf8'),after);
  const {sizeRisk}=await import('file://'+file),{BINANCE_CONFIRMED_POLICY,BINANCE_STOP_POLICY}=await import('file://'+path.join(root,'lib/confirmed-entry-quality.mjs'));
  const input={version:BINANCE_CONFIRMED_POLICY.version,stopLossPolicy:BINANCE_STOP_POLICY,source:'CHANNEL_POC_RETEST_V2',allocationMode:'CURRENT_EQUITY_EQUAL_FIVE_V1'};
  const risk=sizeRisk(100,20,{stopLossPct:2},input);
  assert.equal(risk.reason,'READY');assert.equal(risk.budget,20);assert.equal(risk.riskPlan.riskBudgetUsd,.4);assert.equal(risk.riskPlan.allocationMode,input.allocationMode);
  assert.equal(sizeRisk(100,1e9,{stopLossPct:2},input).reason,'POSITION_RISK_LIMIT');
  assert.equal(sizeRisk(100,20,{stopLossPct:2},{...input,source:'UNREVIEWED_POLICY'}).reason,'INVALID_RISK_INPUT');
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const r=spawnSync(process.execPath,[path.join(root,'scripts/test-channel-poc-runtime.mjs'),root],{env,encoding:'utf8',timeout:60000,maxBuffer:2000000});
  assert.ifError(r.error);assert.equal(r.status,0,r.stdout+r.stderr);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('current equal-equity release is idempotent; modified allocation remains an atomic refusal',()=>{
 for(const kind of ['current','constant','budget']){const root=fixture('deployed');try{
  const file=path.join(root,'lib/confirmed-risk-sizing.mjs');let s=fs.readFileSync(new URL('../lib/confirmed-risk-sizing.mjs',import.meta.url),'utf8');
  if(kind==='constant')s=s.replace('CURRENT_EQUITY_EQUAL_FIVE_V1','CURRENT_EQUITY_EQUAL_FOUR_V1');
  if(kind==='budget')s=s.replace('amount*stopLossPct/100:','amount*stopLossPct/200:');
  fs.writeFileSync(file,s);
  const files=[...new Set(patches.map(p=>p.file))],snapshot=files.map(f=>[f,fs.existsSync(path.join(root,f))?fs.readFileSync(path.join(root,f),'utf8'):null]);
  if(kind==='current'){patchChannelPoc(root,patches);patchChannelPoc(root,patches);assert.equal(fs.readFileSync(file,'utf8'),s);}
  else{assert.throws(()=>patchChannelPoc(root,patches),/confirmed-risk-sizing.*no files changed/);for(const [f,original]of snapshot)assert.equal(fs.existsSync(path.join(root,f))?fs.readFileSync(path.join(root,f),'utf8'):null,original);}
 }finally{fs.rmSync(root,{recursive:true,force:true});}}
});
for(const old of [false,true,'deployed'])test('POC installer atomically migrates '+(old==='deployed'?'actual VPS POC selector':old?'published Binance-only':'shared')+' policy, retains exits and passes installed execution tests',()=>{
 const root=fixture(old);try{
  const server=fs.readFileSync(path.join(root,'server.mjs'),'utf8'),file=path.join(root,'lib/futures-short-policy.mjs'),before=fs.readFileSync(file,'utf8');
  const exit=s=>s.slice(s.indexOf('export const FUTURES_SHORT_EXIT_POLICY='),s.indexOf('export function shortOrderPlan('));
  patchChannelPoc(root,patches);assert.equal(fs.readFileSync(path.join(root,'server.mjs'),'utf8'),server);assert.equal(exit(fs.readFileSync(file,'utf8')),exit(before));assert.match(fs.readFileSync(file,'utf8'),/Deployed exit hook retained/);
  // This is the exact shortConfig supplied from the VPS, not a configuration
  // recreated from the patch output. Preserve selection and activation together.
  const after=fs.readFileSync(file,'utf8');assert.equal(configSource(after),configSource(before));
  if(old==='deployed'){
   const config=vm.runInNewContext('('+configSource(after).replace('export ','').trim()+')',{FUTURES_SHORT_POLICY:{},positive:n=>Number.isFinite(n)&&n>0});
   for(const strategy of [undefined,'CHANNEL','POC'])for(const enabled of ['true','false'])for(const date of ['2026-11-06T00:00:00Z','invalid']){
    const c=config({BINANCE_FUTURES_SHORT_STRATEGY:strategy,BINANCE_FUTURES_SHORT_ENABLED:enabled,BINANCE_FUTURES_SHORT_AFTER:date});
    assert.equal(c.entryMode,strategy==='POC'?'POC_AUTO':'CHANNEL');assert.equal(c.requested,enabled==='true');assert.equal(c.enabled,enabled==='true'&&date!=='invalid');assert.equal(c.enabledAfter,date==='invalid'?null:Date.parse(date));
   }
  }
  const once=Object.fromEntries([...new Set(patches.map(p=>p.file))].map(f=>[f,fs.readFileSync(path.join(root,f),'utf8')]));patchChannelPoc(root,patches);for(const [f,s]of Object.entries(once))assert.equal(fs.readFileSync(path.join(root,f),'utf8'),s);
  const env={...process.env};delete env.NODE_TEST_CONTEXT;const r=spawnSync(process.execPath,[path.join(root,'scripts/test-channel-poc-runtime.mjs'),root],{env,encoding:'utf8',timeout:60000,maxBuffer:2000000});assert.ifError(r.error);assert.equal(r.status,0,r.stdout+r.stderr);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('actual VPS input reproduces the released prefix failure before adding the reviewed selector variant',()=>{
 const root=fixture('deployed');try{
  const released=patches.map(p=>p.id==='short-entry-prefix'?{...p,alternatives:p.alternatives.filter(v=>typeof v==='string')}:p);
  const file=path.join(root,'lib/futures-short-policy.mjs'),before=fs.readFileSync(file,'utf8');
  assert.throws(()=>patchChannelPoc(root,released),/short-entry-prefix.*no files changed/);assert.equal(fs.readFileSync(file,'utf8'),before);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('deployed selector modifications and mixed old/new prefixes are rejected without partial writes',()=>{
 for(const kind of ['selector','guard','old-duplicate','mixed-new','new-duplicate','new-not-at-start']){
  const root=fixture('deployed');try{
   const file=path.join(root,'lib/futures-short-policy.mjs'),p=patches.find(p=>p.id==='short-entry-prefix');
   if(kind.startsWith('new-'))patchChannelPoc(root,patches);
   let s=fs.readFileSync(file,'utf8');
   if(kind==='selector')s=s.replace("==='POC'?'POC_AUTO':'CHANNEL'","==='OTHER'?'POC_AUTO':'CHANNEL'");
   if(kind==='guard')s=s.replace('volumeRatio>=1.5','volumeRatio>=1.1');
   if(kind==='old-duplicate')s+=p.alternatives.find(v=>typeof v==='object').before;
   if(kind==='mixed-new')s+=p.after;
   if(kind==='new-duplicate')s+=p.alternatives.find(v=>typeof v==='object').after;
   if(kind==='new-not-at-start')s='// unreviewed prefix\n'+s;
   fs.writeFileSync(file,s);
   const files=[...new Set(patches.map(p=>p.file))],snapshot=files.map(f=>[f,fs.existsSync(path.join(root,f))?fs.readFileSync(path.join(root,f),'utf8'):null]);
   assert.throws(()=>patchChannelPoc(root,patches),/short-entry-prefix.*no files changed/);
   for(const [f,original]of snapshot)assert.equal(fs.existsSync(path.join(root,f))?fs.readFileSync(path.join(root,f),'utf8'):null,original);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 }
});
test('unknown entry guards, duplicate layouts and edited new helpers abort before any staged file changes',()=>{
 for(const kind of ['guard','duplicate','helper']){const root=fixture();try{
 const file=path.join(root,'lib/channel-primary-entry.mjs');if(kind==='guard')fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('export function channelEntry(','export function ownerChannelEntry('));
 if(kind==='duplicate')fs.appendFileSync(file,fs.readFileSync(file,'utf8'));
 if(kind==='helper')fs.writeFileSync(path.join(root,'lib/channel-poc-entry.mjs'),'custom helper');
 const files=[...new Set(patches.map(p=>p.file))],snapshot=files.map(f=>[f,fs.existsSync(path.join(root,f))?fs.readFileSync(path.join(root,f),'utf8'):null]);
 assert.throws(()=>patchChannelPoc(root,patches),/no files changed/);
 for(const [f,s]of snapshot)assert.equal(fs.existsSync(path.join(root,f))?fs.readFileSync(path.join(root,f),'utf8'):null,s);
 }finally{fs.rmSync(root,{recursive:true,force:true});}}
});
