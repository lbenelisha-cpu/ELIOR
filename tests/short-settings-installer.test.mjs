import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {patchShortSettings} from '../scripts/patch-short-settings-exit.mjs';
const patches=JSON.parse(fs.readFileSync(new URL('../scripts/short-settings-exit-patches.json',import.meta.url),'utf8'));
test('SHORT installer applies only recognized changes, preserves unrelated code, and is repeatable',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'short-settings-test-'));
 try{
  const expected=new Map();
  for(const file of new Set(patches.map(p=>p.file))){
   const next=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8')+'\n// Preserve local deployment integration\n';
   expected.set(file,next);let old=next;
   for(const p of patches.filter(p=>p.file===file).reverse()){
    assert.equal(old.split(p.after).length,2);old=old.replace(p.after,p.before);
   }
   fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),old);
  }
  patchShortSettings(dir,patches);patchShortSettings(dir,patches);
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
