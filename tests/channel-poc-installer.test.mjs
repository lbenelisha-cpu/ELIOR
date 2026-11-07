import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
import {patchChannelPoc} from '../scripts/patch-channel-poc.mjs';
const base=new URL('../',import.meta.url),patches=JSON.parse(fs.readFileSync(new URL('../scripts/channel-poc-patches.json',import.meta.url),'utf8'));
function fixture(historical=false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'poc-installer-'));
 for(const dir of ['lib','scripts','tests'])fs.cpSync(new URL('../'+dir,import.meta.url),path.join(root,dir),{recursive:true});
 for(const f of fs.readdirSync(base,{withFileTypes:true}))if(f.isFile()&&!f.name.startsWith('.'))fs.copyFileSync(new URL('../'+f.name,import.meta.url),path.join(root,f.name));
 for(const p of [...patches].reverse()){
  const file=path.join(root,p.file);if(p.before===null){fs.rmSync(file,{force:true});continue;}
  const s=fs.readFileSync(file,'utf8');assert.equal(s.split(p.after).length,2,p.id);fs.writeFileSync(file,s.replace(p.after,p.before));
 }
 if(historical)fs.copyFileSync(new URL('./fixtures/pre-poc/futures-short-binance-parallel.mjs',import.meta.url),path.join(root,'lib/futures-short-policy.mjs'));
 fs.appendFileSync(path.join(root,'lib/futures-short-policy.mjs'),'\n// Deployed exit hook retained\n');
 const server=path.join(root,'server.mjs'),s=fs.readFileSync(server,'utf8'),start=s.indexOf('async function executeLiveCycle('),end=s.indexOf('async function getLiveAccountSnapshot(',start);
 const cycle=fs.readFileSync(new URL('./fixtures/binance-live-cycle-deployed-20261106.txt',import.meta.url),'utf8');fs.writeFileSync(server,s.slice(0,start)+cycle+s.slice(end));
 return root;
}
for(const old of [false,true])test('POC installer atomically migrates '+(old?'published Binance-only':'shared')+' policy, retains exits and passes installed execution tests',()=>{
 const root=fixture(old);try{
  const server=fs.readFileSync(path.join(root,'server.mjs'),'utf8'),file=path.join(root,'lib/futures-short-policy.mjs'),before=fs.readFileSync(file,'utf8');
  const exit=s=>s.slice(s.indexOf('export const FUTURES_SHORT_EXIT_POLICY='),s.indexOf('export function shortOrderPlan('));
  patchChannelPoc(root,patches);assert.equal(fs.readFileSync(path.join(root,'server.mjs'),'utf8'),server);assert.equal(exit(fs.readFileSync(file,'utf8')),exit(before));assert.match(fs.readFileSync(file,'utf8'),/Deployed exit hook retained/);
  const once=Object.fromEntries([...new Set(patches.map(p=>p.file))].map(f=>[f,fs.readFileSync(path.join(root,f),'utf8')]));patchChannelPoc(root,patches);for(const [f,s]of Object.entries(once))assert.equal(fs.readFileSync(path.join(root,f),'utf8'),s);
  const env={...process.env};delete env.NODE_TEST_CONTEXT;const r=spawnSync(process.execPath,[path.join(root,'scripts/test-channel-poc-runtime.mjs'),root],{env,encoding:'utf8',timeout:60000,maxBuffer:2000000});assert.ifError(r.error);assert.equal(r.status,0,r.stdout+r.stderr);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
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
