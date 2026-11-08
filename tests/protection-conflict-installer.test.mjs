import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {patchProtectionConflict} from '../scripts/patch-protection-conflict.mjs';
test('conflict installer retains installed price checks, repeats safely and refuses unknown layouts atomically',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'protection-conflict-'));fs.mkdirSync(path.join(dir,'lib'));
 const target=path.join(dir,'lib/futures-short-runner.mjs'),current=fs.readFileSync(new URL('../lib/futures-short-runner.mjs',import.meta.url),'utf8');
 const patches=JSON.parse(fs.readFileSync(new URL('../scripts/protection-conflict-patches.json',import.meta.url),'utf8'));
 let old=current;for(const [before,after]of [...patches].reverse()){assert.equal(old.split(after).length,2);old=old.replace(after,before);}
 const check="\n  await this.api.get('/fapi/v1/ticker/price',{symbol:p.symbol});";
 old=old.replace(' async ensureAlgo(p,kind,price){',' async ensureAlgo(p,kind,price){'+check);
 try{
  fs.writeFileSync(target,old);patchProtectionConflict(dir);const installed=fs.readFileSync(target,'utf8');
  assert.equal(installed,current.replace(' async ensureAlgo(p,kind,price,allowConflictRecovery=true){',' async ensureAlgo(p,kind,price,allowConflictRecovery=true){'+check));
  patchProtectionConflict(dir);assert.equal(fs.readFileSync(target,'utf8'),installed);
  const unknown=old.replace(' async cycle(){',' async customCycle(){');fs.writeFileSync(target,unknown);
  assert.throws(()=>patchProtectionConflict(dir),/Unrecognized/);assert.equal(fs.readFileSync(target,'utf8'),unknown);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
