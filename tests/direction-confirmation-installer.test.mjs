import {rewindDynamicFixture,preDynamicSource} from './helpers/pre-dynamic-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {patchDirectionConfirmation,directionPatches} from '../scripts/patch-direction-confirmation.mjs';
const source=new URL('../',import.meta.url);
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'direction-install-'));
 for(const name of ['lib','scripts','tests'])fs.cpSync(new URL(name,source),path.join(root,name),{recursive:true});
 for(const name of fs.readdirSync(source).filter(n=>/\.(m?js|json)$/.test(n)))fs.copyFileSync(new URL(name,source),path.join(root,name));
 rewindDynamicFixture(root);
 for(const file of new Set(directionPatches.map(p=>p.file))){
  const target=path.join(root,file),patches=directionPatches.filter(p=>p.file===file);
  if(patches.some(p=>p.before===null)){fs.rmSync(target);continue;}
  let text=fs.readFileSync(target,'utf8');
  for(const p of [...patches].reverse()){assert.equal(text.split(p.after).length,2,file);text=text.replace(p.after,p.before);}
  fs.writeFileSync(target,text);
 }
 return root;
}
function snapshot(root){return new Map([...new Set(directionPatches.map(p=>p.file))].map(file=>[file,fs.existsSync(path.join(root,file))?fs.readFileSync(path.join(root,file),'utf8'):null]));}
test('direction installer upgrades the prior runtime, retains local exit checks, and passes installed execution tests',()=>{
 const root=fixture();
 try{
  const file=path.join(root,'lib/futures-short-runner.mjs');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(' async quote(symbol){'," async quote(symbol){\n  await this.api.get('/fapi/v1/ticker/price',{symbol});"));
  fs.appendFileSync(path.join(root,'server.mjs'),'\n// local monitoring integration\n');
  patchDirectionConfirmation(root);const once=snapshot(root);patchDirectionConfirmation(root);assert.deepEqual(snapshot(root),once);
  assert.match(fs.readFileSync(file,'utf8'),/await this.api.get\('\/fapi\/v1\/ticker\/price'/);
  assert.match(fs.readFileSync(path.join(root,'server.mjs'),'utf8'),/local monitoring integration/);
  for(const [name,text]of once)if(!['server.mjs','lib/futures-short-runner.mjs'].includes(name))assert.equal(text,preDynamicSource(fs.readFileSync(new URL(name,source),'utf8'),name),name);
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const tests=['poc-direction-confirmation','futures-trend-history','channel-poc-entry','channel-primary-entry','futures-short','futures-short-recovery','futures-short-fill'];
  const run=spawnSync(process.execPath,['--test',...tests.map(n=>path.join(root,'tests',n+'.test.mjs'))],{env,encoding:'utf8',timeout:60000,maxBuffer:2000000});
  assert.ifError(run.error);assert.equal(run.status,0,run.stdout+run.stderr);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('unknown, duplicate, mixed or edited entry code refuses all staged writes',()=>{
 for(const kind of ['unknown','duplicate','mixed','edited-helper']){
  const root=fixture();
  try{
   const patch=directionPatches.find(p=>p.file==='lib/futures-short-policy.mjs'),file=path.join(root,patch.file);
   if(kind==='edited-helper')fs.writeFileSync(path.join(root,'lib/poc-direction-confirmation.mjs'),'unreviewed helper');
   else{
    const text=fs.readFileSync(file,'utf8');
    fs.writeFileSync(file,kind==='unknown'?text.replace(patch.before,'unreviewed entry guard'):kind==='duplicate'?text+'\n'+patch.before:text+'\n'+patch.after);
   }
   const before=snapshot(root);assert.throws(()=>patchDirectionConfirmation(root),/no files changed/);assert.deepEqual(snapshot(root),before);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 }
});
test('installer checks pending Spot and SHORT before and after stopping, and verifies both policies',()=>{
 const file=new URL('../scripts/install-direction-confirmation.sh',import.meta.url),script=fs.readFileSync(file,'utf8');
 assert.equal(spawnSync('bash',['-n',file.pathname]).status,0);
 assert.equal(script.split('assertNoPendingEntry({spotPending,journal});').length,3);
 assert.match(script,/d\.shortTrading\?\.policy\?\.confirmationPolicy/);assert.match(script,/d\.channelPrimary\?\.confirmationPolicy/);
 assert.match(script,/trap rollback ERR/);assert.doesNotMatch(script,/git (?:reset|checkout|pull)|\/fapi\/v1\/order/);
});
