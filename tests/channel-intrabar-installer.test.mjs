import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {patchIntrabar} from '../scripts/patch-channel-intrabar.mjs';
const patches=JSON.parse(fs.readFileSync(new URL('../scripts/channel-intrabar-server-patches.json',import.meta.url),'utf8'));
test('intrabar patch preserves custom server code, is idempotent, and rejects unknown contexts without partial writes',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'channel-intrabar-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'server.mjs'),after=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8')+'\n// owner customization\n';
 let before=after;for(const p of patches.toReversed()){assert.ok(before.includes(p.after));before=before.replace(p.after,p.before);}
 fs.writeFileSync(file,before);patchIntrabar(dir);assert.equal(fs.readFileSync(file,'utf8'),after);patchIntrabar(dir);assert.equal(fs.readFileSync(file,'utf8'),after);
 const unknown=before.replace(patches.at(-1).before,'// unknown integration');fs.writeFileSync(file,unknown);assert.throws(()=>patchIntrabar(dir),/No files changed/);assert.equal(fs.readFileSync(file,'utf8'),unknown);
});
