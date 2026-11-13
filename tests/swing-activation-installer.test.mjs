import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
const patches=JSON.parse(fs.readFileSync(new URL('../scripts/swing-activation-patches.json',import.meta.url)));
test('activation installer preserves unrelated guards, is idempotent and aborts all writes on unknown code',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'activation-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.mkdirSync(path.join(dir,'lib'));
 const names=[...new Set(patches.map(p=>p.file))];
 for(const name of names){let s=fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');for(const p of patches.filter(p=>p.file===name).reverse())s=s.replace(p.after,p.before);fs.writeFileSync(path.join(dir,name),'// retained local guard\n'+s);}
 const run=()=>execFileSync(process.execPath,[new URL('../scripts/patch-swing-activation.mjs',import.meta.url).pathname,dir],{stdio:'pipe'});
 const last=path.join(dir,names.at(-1)),original=fs.readFileSync(last,'utf8');fs.writeFileSync(last,original+'\n'+patches.at(-1).before);
 const first=fs.readFileSync(path.join(dir,names[0]),'utf8');assert.throws(run);assert.equal(fs.readFileSync(path.join(dir,names[0]),'utf8'),first);fs.writeFileSync(last,original);run();
 const installed=names.map(n=>fs.readFileSync(path.join(dir,n),'utf8'));run();assert.deepEqual(names.map(n=>fs.readFileSync(path.join(dir,n),'utf8')),installed);assert.ok(installed.every(s=>s.startsWith('// retained local guard')));
});

test('Binance-only runtime omits Colmex adapter but still rejects missing required modules',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'activation-binance-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.mkdirSync(path.join(dir,'lib'));
 const names=[...new Set(patches.map(p=>p.file))].filter(n=>!n.includes('colmex-position-exit'));
 for(const name of names){let s=fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');for(const p of patches.filter(p=>p.file===name).reverse())s=s.replace(p.after,p.before);fs.writeFileSync(path.join(dir,name),s);}
 const run=()=>execFileSync(process.execPath,[new URL('../scripts/patch-swing-activation.mjs',import.meta.url).pathname,dir],{stdio:'pipe'});
 const required=path.join(dir,names.at(-1)),saved=fs.readFileSync(required);fs.unlinkSync(required);
 const first=fs.readFileSync(path.join(dir,names[0]),'utf8');assert.throws(run);assert.equal(fs.readFileSync(path.join(dir,names[0]),'utf8'),first);
 fs.writeFileSync(required,saved);run();run();assert.equal(fs.existsSync(path.join(dir,'lib/colmex-position-exit.mjs')),false);
 for(const p of patches.filter(p=>names.includes(p.file)))assert.ok(fs.readFileSync(path.join(dir,p.file),'utf8').includes(p.after));
});
