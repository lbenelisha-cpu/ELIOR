import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {patchPoc} from '../scripts/patch-binance-poc.mjs';
const patches=JSON.parse(fs.readFileSync(new URL('../scripts/binance-poc-patches.json',import.meta.url),'utf8'));
test('POC installer patches reproduce reviewed code, are idempotent and leave unknown integrations untouched',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'poc-install-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const files=[...new Set(patches.map(p=>p.file))],expected={};
 for(const file of files){
  expected[file]=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');let before=expected[file];
  for(const p of patches.filter(p=>p.file===file).reverse()){assert.ok(before.includes(p.after),file);before=before.replace(p.after,p.before);}
  fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),before);
 }
 patchPoc(dir,patches);patchPoc(dir,patches);
 for(const file of files)assert.equal(fs.readFileSync(path.join(dir,file),'utf8'),expected[file]);
 assert.throws(()=>patchPoc(dir,[...patches,{file:'server.mjs',before:'unknown-context',after:'oops'}]),/Unknown/);
 for(const file of files)assert.equal(fs.readFileSync(path.join(dir,file),'utf8'),expected[file]);
});
test('POC controls require existing device authorization, and the read proxy exposes only GET',async()=>{
 const {readTarget,createReadProxy}=await import('../netlify/functions/binance-read-proxy.mjs');
 assert.equal(readTarget('/api/binance-live/poc').pathname,'/api/binance-live/poc');
 const reply=await createReadProxy(()=>{throw Error('must not fetch');})({httpMethod:'POST',queryStringParameters:{path:'/api/binance-live/poc'}});assert.equal(reply.statusCode,405);
 const s=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.ok(s.indexOf('if(protectedControl&&!authorized)')<s.indexOf("if(u.pathname==='/api/binance-live/poc')"));
 assert.match(s,/u\.pathname\.startsWith\('\/api\/binance-live\/'\)/);
});
