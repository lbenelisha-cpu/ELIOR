import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {patchAuditTimestamps} from '../scripts/patch-audit-timestamps.mjs';

const release=fileURLToPath(new URL('..',import.meta.url));
const fixedModule=fs.readFileSync(path.join(release,'lib/ma-decision-audit.mjs'),'utf8');
const oldModule=fixedModule.replace(/\/\/ Binance sends ISO source timestamps;[^]*?\n};\n/,'').replace(' priceAt=sourceTime(priceAt);\n','');
const fixedServer=fs.readFileSync(path.join(release,'server.mjs'),'utf8')+'\n// Local deployment customizations remain.\n';
const oldServer=fixedServer.replace('priceAt:streams[event.symbol]?.lastEventAt,...details','priceAt:Number(streams[event.symbol]?.lastEventAt),...details');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'audit-patch-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'lib'));
 fs.writeFileSync(path.join(root,'lib/ma-decision-audit.mjs'),oldModule);
 fs.writeFileSync(path.join(root,'server.mjs'),oldServer);
 return root;
}
test('audit installer patches only source time handling, preserves local server changes and reruns',t=>{
 const root=fixture(t);
 for(let i=0;i<2;i++){
  patchAuditTimestamps(root,release);
  assert.equal(fs.readFileSync(path.join(root,'server.mjs'),'utf8'),fixedServer);
  assert.equal(fs.readFileSync(path.join(root,'lib/ma-decision-audit.mjs'),'utf8'),fixedModule);
 }
});
test('unknown observer or audit module fails before either installed file is changed',t=>{
 for(const target of ['server.mjs','lib/ma-decision-audit.mjs']){
  const root=fixture(t),file=path.join(root,target);
  fs.writeFileSync(file,target==='server.mjs'?'// Missing integration':oldModule+'\n// Unreviewed module change');
  const before=['server.mjs','lib/ma-decision-audit.mjs'].map(f=>fs.readFileSync(path.join(root,f),'utf8'));
  assert.throws(()=>patchAuditTimestamps(root,release),/Unrecognized/);
  assert.deepEqual(['server.mjs','lib/ma-decision-audit.mjs'].map(f=>fs.readFileSync(path.join(root,f),'utf8')),before);
 }
});
