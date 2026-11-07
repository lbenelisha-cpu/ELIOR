import {upgradePocFixture} from './helpers/upgrade-poc-fixture.mjs';
import {restorePreParallelLayout} from './helpers/pre-parallel-entry-layout.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {prePocFs as fs} from './helpers/pre-poc-source.mjs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {patchChannelConsolidation} from '../scripts/patch-channel-consolidation.mjs';
import {patchShortSettings} from '../scripts/patch-short-settings-exit.mjs';
const patches=JSON.parse(fs.readFileSync(new URL('../scripts/channel-consolidation-patches.json',import.meta.url),'utf8'));
const shortPatches=JSON.parse(fs.readFileSync(new URL('../scripts/short-settings-exit-patches.json',import.meta.url),'utf8'));
function reverse(root,list){
 for(const file of new Set(list.map(p=>p.file))){
  const dest=path.join(root,file);let s=fs.readFileSync(dest,'utf8');
  for(const p of list.filter(p=>p.file===file).reverse()){assert.equal(s.split(p.after).length,2);s=s.replace(p.after,p.before);}
  fs.writeFileSync(dest,s);
 }
}
test('consolidation installer is repeatable, rejects unknown context atomically and retains installed SHORT integrations',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'consolidation-install-'));
 try{
  for(const name of ['lib','tests','scripts'])fs.cpSync(new URL('../'+name,import.meta.url),path.join(dir,name),{recursive:true});
  for(const name of ['server.mjs','binance-agent.js','regression-trend.js','parallel-channel.js'])fs.copyFileSync(new URL('../'+name,import.meta.url),path.join(dir,name));
  restorePreParallelLayout(dir);
  // A harmless local server edit breaks the original installer's old anchor,
  // while leaving the settings and consolidation patches applicable.
  const serverPath=path.join(dir,'server.mjs'),server=fs.readFileSync(serverPath,'utf8');
  const oldAnchor='const server=http.createServer((req,res)=>{';
  assert.equal(server.split(oldAnchor).length,2);
  const deployedServer=server.replace(oldAnchor,'const server = http.createServer((req,res)=>{');
  fs.writeFileSync(serverPath,deployedServer);
  const expected=new Map([...new Set(patches.map(p=>p.file))].map(file=>[file,fs.readFileSync(path.join(dir,file),'utf8')]));
  reverse(dir,patches);
  // Also support the owner who has not yet completed the previous SHORT update.
  reverse(dir,shortPatches);patchShortSettings(dir,shortPatches);
  const runner=path.join(dir,'lib/futures-short-runner.mjs'),comment='\n// Keep installed protection integration\n';
  fs.appendFileSync(runner,comment);
  const before=new Map([...expected.keys()].map(file=>[file,fs.readFileSync(path.join(dir,file),'utf8')]));
  assert.throws(()=>patchChannelConsolidation(dir,[...patches,{file:'lib/futures-short-runner.mjs',before:'missing source anchor',after:'never write this'}]),/Unrecognized/);
  for(const [file,s]of before)assert.equal(fs.readFileSync(path.join(dir,file),'utf8'),s);
  patchChannelConsolidation(dir,patches);patchChannelConsolidation(dir,patches);
  for(const [file,s]of expected)assert.equal(fs.readFileSync(path.join(dir,file),'utf8'),s+(file==='lib/futures-short-runner.mjs'?comment:''));
  assert.equal(fs.readFileSync(serverPath,'utf8'),deployedServer,'retain local server integration');
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const options={env,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024};
  const legacyTest=path.join(dir,'tests/futures-short-installer.test.mjs');
  const former=spawnSync(process.execPath,['--test',legacyTest],options);
  assert.ifError(former.error);assert.notEqual(former.status,0);
  assert.match(former.stdout+former.stderr,/Unrecognized server\.mjs integration context/);
  // Keep that test, but run it against the reviewed release it actually tests.
  const releaseTest=new URL('./futures-short-installer.test.mjs',import.meta.url);
  const release=spawnSync(process.execPath,['--test',releaseTest.pathname],options);
  assert.ifError(release.error);assert.equal(release.status,0,release.stdout+release.stderr);
  upgradePocFixture(dir);
  const tests=['channel-consolidation','channel-consolidation-entry','futures-short','futures-short-recovery','futures-short-fill'].map(f=>path.join(dir,'tests',f+'.test.mjs'));
  const run=spawnSync(process.execPath,['--test',...tests],options);
  assert.ifError(run.error);assert.equal(run.status,0,run.stdout+run.stderr);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
