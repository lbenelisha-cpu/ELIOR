import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const allowed=new Set(['server.mjs','lib/channel-primary-entry.mjs','lib/futures-short-policy.mjs','lib/channel-condition-report.mjs','lib/wyckoff-evaluation.mjs','lib/entry-method-comparison.mjs','lib/market-attention.mjs','lib/shared-market-watch.mjs']);
export function patchParallelChecks(root,patches){
 const pending=new Map();
 for(const {id,file,before,after} of patches){
  if(!allowed.has(file)||typeof after!=='string'||!after)throw Error('Invalid parallel-check patch');
  const target=path.join(root,file),source=pending.get(file)??(fs.existsSync(target)?fs.readFileSync(target,'utf8'):null);
  const fail=()=>{throw Error('Unrecognized '+file+' context ['+id+']; no files changed');};
  if(before===null){if(source!==null&&source!==after)fail();pending.set(file,after);continue;}
  if(typeof source!=='string'||typeof before!=='string'||!before)fail();
  const updated=source.split(after).length-1;
  if(updated===1)continue;
  if(updated>1||source.split(before).length!==2)fail();
  pending.set(file,source.replace(before,after));
 }
 for(const [file,source]of pending){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),source);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)patchParallelChecks(process.argv[2],JSON.parse(fs.readFileSync(new URL('./parallel-entry-checks-patches.json',import.meta.url),'utf8')));
