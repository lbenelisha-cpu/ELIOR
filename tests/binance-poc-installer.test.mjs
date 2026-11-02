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
 const htmlFile=path.join(dir,'binance-agent.html');
 let html=expected['binance-agent.html'];
 for(const p of patches.filter(p=>p.file==='binance-agent.html').reverse())html=html.replace(p.after,p.before);
 // Production may have older independent chart assets; POC must preserve them.
 html=html.replace('<link rel="stylesheet" href="/chart-terminal.css?v=20261101-chart-terminal">','').replace('  <script src="/channel-watch.js?v=20261101-watch"></script>\n','').replace('binance-futures-positions.js?v=20261101-channel-watch','binance-futures-positions.js?v=20261101-short-table');
 fs.writeFileSync(htmlFile,html);patchPoc(dir,patches);patchPoc(dir,patches);
 const patchedHtml=fs.readFileSync(htmlFile,'utf8');
 assert.ok(patchedHtml.includes('id="pocPanel"'));
 assert.ok(patchedHtml.includes('/binance-poc.js'));
 assert.ok(patchedHtml.includes('binance-futures-positions.js?v=20261101-short-table'));
 assert.ok(!patchedHtml.includes('/chart-terminal.css'));
 fs.writeFileSync(htmlFile,expected['binance-agent.html']);
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
