import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
