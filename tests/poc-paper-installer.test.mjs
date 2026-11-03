import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';
import {patchPaper} from '../scripts/patch-poc-paper.mjs';
const root=new URL('../',import.meta.url),patches=JSON.parse(fs.readFileSync(new URL('scripts/poc-paper-patches.json',root),'utf8'));
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paper-patch-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));for(const file of new Set(patches.map(p=>p.file))){const content=fs.readFileSync(new URL(file,root),'utf8');fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),content);}return dir;}
test('installer patches are additive and idempotent and reject unknown source before writing',t=>{
 const dir=fixture(t);patchPaper(dir);const files=[...new Set(patches.map(p=>p.file))];const original=files.map(f=>fs.readFileSync(path.join(dir,f),'utf8'));patchPaper(dir);assert.deepEqual(files.map(f=>fs.readFileSync(path.join(dir,f),'utf8')),original);
 for(const patch of [...patches].reverse()){const p=path.join(dir,patch.file);fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(patch.after,patch.before));}
 const before=files.map(f=>fs.readFileSync(path.join(dir,f),'utf8'));patchPaper(dir);assert.deepEqual(files.map(f=>fs.readFileSync(path.join(dir,f),'utf8')),original);
 files.forEach((f,i)=>fs.writeFileSync(path.join(dir,f),before[i]));fs.writeFileSync(path.join(dir,'binance-agent.js'),'unrecognized app');assert.throws(()=>patchPaper(dir),/no files changed/);assert.equal(fs.readFileSync(path.join(dir,'server.mjs'),'utf8'),before[0]);
});
test('installer syntax, rollback and no credentials or trading settings mutations',()=>{
 const file=new URL('scripts/install-poc-paper.sh',root);execFileSync('bash',['-n',file.pathname]);const text=fs.readFileSync(file,'utf8');assert.match(text,/trap rollback ERR/);assert.doesNotMatch(text,/\.env|AUTO_EXECUTION=|BINANCE_MODE=|api\/binance-live\/buy/);
});
