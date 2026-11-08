import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {patchShortQuoteRecovery} from '../scripts/patch-short-quote-recovery.mjs';
test('recovery patch is idempotent and rejects unknown anchors without writing',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'short-patch-'));fs.mkdirSync(path.join(dir,'lib'));
 const file=path.join(dir,'lib/futures-short-runner.mjs'),source=fs.readFileSync(new URL('../lib/futures-short-runner.mjs',import.meta.url),'utf8');
 try{
  fs.writeFileSync(file,source);patchShortQuoteRecovery(dir);assert.equal(fs.readFileSync(file,'utf8'),source);
  const unknown=source.replace('this.recoverFreshQuoteHalt(account,managedAt);','this.unknownRecovery();');
  fs.writeFileSync(file,unknown);assert.throws(()=>patchShortQuoteRecovery(dir),/UNRECOGNIZED/);assert.equal(fs.readFileSync(file,'utf8'),unknown);
 }finally{fs.rmSync(dir,{recursive:true});}
});
