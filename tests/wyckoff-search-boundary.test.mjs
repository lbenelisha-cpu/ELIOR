import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createSearchBoundaries} from '../lib/wyckoff-search-boundary.mjs';
test('boundaries survive restart, never move backwards and isolate modes/symbols',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rsi-reset-'));try{
 const file=path.join(dir,'state.json'),a=createSearchBoundaries(file);a.advance('live:SOLUSDT',100);a.advance('live:SOLUSDT',50);
 const b=createSearchBoundaries(file);assert.equal(b.get('live:SOLUSDT'),100);assert.equal(b.get('demo:SOLUSDT'),0);assert.equal(b.get('live:BTCUSDT'),0);
 fs.writeFileSync(file,'broken');assert.throws(()=>createSearchBoundaries(file).get('live:SOLUSDT'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
