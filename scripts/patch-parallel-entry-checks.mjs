import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parallelPatchVariants} from './parallel-entry-layouts.mjs';
const allowed=new Set(['server.mjs','lib/channel-primary-entry.mjs','lib/futures-short-policy.mjs','lib/channel-condition-report.mjs','lib/wyckoff-evaluation.mjs','lib/entry-method-comparison.mjs','lib/market-attention.mjs','lib/shared-market-watch.mjs']);
export function patchParallelChecks(root,patches){
 const pending=new Map();
 for(const patch of patches){
  const {id,file,before,after}=patch;
  if(!allowed.has(file)||typeof after!=='string'||!after)throw Error('Invalid parallel-check patch');
  const target=path.join(root,file),source=pending.get(file)??(fs.existsSync(target)?fs.readFileSync(target,'utf8'):null);
  const fail=()=>{throw Error('Unrecognized '+file+' context ['+id+']; no files changed');};
  if(before===null){if(source!==null&&source!==after)fail();pending.set(file,after);continue;}
  if(typeof source!=='string'||typeof before!=='string'||!before)fail();
  const variants=parallelPatchVariants(patch),matches=[];
  for(const v of variants){
   const old=source.split(v.before).length-1,updated=source.split(v.after).length-1;
   if(old>1||updated>1)fail();
   if(old&&(!patch.atStart||source.startsWith(v.before)))matches.push({variant:v,updated:false,index:source.indexOf(v.before)});
   if(updated&&(!patch.atStart||source.startsWith(v.after)))matches.push({variant:v,updated:true,index:source.indexOf(v.after)});
  }
  // Never accept mixed/duplicated layouts or silently discard custom guards.
  const exact=matches.filter(m=>m.updated),uncovered=matches.filter(m=>!m.updated&&!exact.some(e=>m.index>=e.index&&m.index+m.variant.before.length<=e.index+e.variant.after.length));
  const candidates=[...exact,...uncovered];
  if(candidates.length!==1)fail();
  const match=candidates[0];
  if(!match.updated)pending.set(file,source.replace(match.variant.before,match.variant.after));
 }
 for(const [file,source]of pending){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),source);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)patchParallelChecks(process.argv[2],JSON.parse(fs.readFileSync(new URL('./parallel-entry-checks-patches.json',import.meta.url),'utf8')));
