import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';
import {patchPaper} from '../scripts/patch-poc-paper.mjs';
const root=new URL('../',import.meta.url),patches=JSON.parse(fs.readFileSync(new URL('scripts/poc-paper-patches.json',root),'utf8'));
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paper-patch-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));for(const file of new Set(patches.map(p=>p.file))){/* The historical installer patches exact, immutable manifest contexts. */ const content=patches.filter(p=>p.file===file).map(p=>p.after).join('\n// retained integration boundary\n');fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),content);}return dir;}
test('installer patches are additive and idempotent and reject unknown source before writing',t=>{
 const dir=fixture(t);patchPaper(dir);const files=[...new Set(patches.map(p=>p.file))];const original=files.map(f=>fs.readFileSync(path.join(dir,f),'utf8'));patchPaper(dir);assert.deepEqual(files.map(f=>fs.readFileSync(path.join(dir,f),'utf8')),original);
 for(const patch of [...patches].reverse()){const p=path.join(dir,patch.file);fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(patch.after,patch.before));}
 const before=files.map(f=>fs.readFileSync(path.join(dir,f),'utf8'));patchPaper(dir);assert.deepEqual(files.map(f=>fs.readFileSync(path.join(dir,f),'utf8')),original);
 files.forEach((f,i)=>fs.writeFileSync(path.join(dir,f),before[i]));fs.writeFileSync(path.join(dir,'binance-agent.js'),'unrecognized app');assert.throws(()=>patchPaper(dir),/no files changed/);assert.equal(fs.readFileSync(path.join(dir,'server.mjs'),'utf8'),before[0]);
});
test('installer syntax, rollback and no credentials or trading settings mutations',()=>{
 const file=new URL('scripts/install-poc-paper.sh',root);execFileSync('bash',['-n',file.pathname]);const text=fs.readFileSync(file,'utf8');assert.match(text,/trap rollback ERR/);assert.doesNotMatch(text,/\.env|AUTO_EXECUTION=|BINANCE_MODE=|api\/binance-live\/buy/);
});
test('legacy server proxy receives only the paper GET route without replacing its allowlist',t=>{
 const dir=fixture(t),file=path.join(dir,'netlify/functions/binance-read-proxy.mjs');
 const legacy="const READ_PATHS=new Set(['/api/binance-trading-pnl','/api/binance-mode']);\nconst preserved='legacy';\n";
 fs.writeFileSync(file,legacy);patchPaper(dir);
 const expected=legacy.replace('const READ_PATHS=new Set([',"const READ_PATHS=new Set(['/api/binance-poc-paper',");
 assert.equal(fs.readFileSync(file,'utf8'),expected);patchPaper(dir);assert.equal(fs.readFileSync(file,'utf8'),expected);
});
