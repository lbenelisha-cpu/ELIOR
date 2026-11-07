import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {patchPoc} from '../scripts/patch-binance-poc.mjs';
const patches=JSON.parse(fs.readFileSync(new URL('../scripts/binance-poc-patches.json',import.meta.url),'utf8'));
test('historical POC patch contexts are idempotent and reject unknown integrations atomically',t=>{
 // These immutable manifest contexts predate later server/allowlist updates.
 // Current execution paths are exercised by futures-short and channel-primary tests.
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'poc-install-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const p of patches){
  const file=path.join(dir,p.file),original='// owner prefix\n'+p.before+'\n// owner suffix';
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,original);
  assert.throws(()=>patchPoc(dir,[p,{file:p.file,before:'unknown-context',after:'never write'}]),/Unknown/);assert.equal(fs.readFileSync(file,'utf8'),original);
  patchPoc(dir,[p]);const expected=original.replace(p.before,p.after);assert.equal(fs.readFileSync(file,'utf8'),expected);patchPoc(dir,[p]);assert.equal(fs.readFileSync(file,'utf8'),expected);
 }
});
test('POC controls require existing device authorization, and the read proxy exposes only GET',async()=>{
 const {readTarget,createReadProxy}=await import('../netlify/functions/binance-read-proxy.mjs');
 assert.equal(readTarget('/api/binance-live/poc').pathname,'/api/binance-live/poc');
 const reply=await createReadProxy(()=>{throw Error('must not fetch');})({httpMethod:'POST',queryStringParameters:{path:'/api/binance-live/poc'}});assert.equal(reply.statusCode,405);
 const s=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.ok(s.indexOf('if(protectedControl&&!authorized)')<s.indexOf("if(u.pathname==='/api/binance-live/poc')"));
 assert.match(s,/u\.pathname\.startsWith\('\/api\/binance-live\/'\)/);
});
