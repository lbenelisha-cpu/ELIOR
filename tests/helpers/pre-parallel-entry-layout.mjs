// Legacy installer tests must reconstruct the layout those releases patched.
// Keep exact anchor assertions; do not weaken the original installers' checks.
import fs from 'node:fs';
import {readPrePocSource} from './pre-poc-source.mjs';
import assert from 'node:assert/strict';
const patches=JSON.parse(fs.readFileSync(new URL('../../scripts/parallel-entry-checks-patches.json',import.meta.url),'utf8'));
export function beforeParallelChecks(file,source){
 for(const p of patches.filter(p=>p.file===file&&p.before!==null).reverse()){
  assert.equal(source.split(p.after).length,2,'reviewed parallel patch '+p.id);
  source=source.replace(p.after,p.before);
 }
 return source;
}
export function restorePreParallelLayout(root){
 for(const file of new Set(patches.filter(p=>p.before!==null).map(p=>p.file))){
  const name=root+'/'+file;fs.writeFileSync(name,beforeParallelChecks(file,readPrePocSource(new URL('../../'+file,import.meta.url),'utf8')));
 }
}
