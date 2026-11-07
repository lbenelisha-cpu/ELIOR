import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export function patchChannelPoc(root,patches){
 const pending=new Map();
 for(const p of patches){
  if(!/^(?:lib\/[a-z0-9-]+\.mjs|channel-poc-model\.js)$/.test(p.file)||!p.after)throw Error('Invalid POC patch');
  const file=path.join(root,p.file),source=pending.get(p.file)??(fs.existsSync(file)?fs.readFileSync(file,'utf8'):null);
  const fail=()=>{throw Error('Unrecognized '+p.file+' ['+p.id+']; no files changed');};
  if(p.before===null){if(source!==null&&source!==p.after)fail();pending.set(p.file,p.after);continue;}
  if(source===null)fail();
  const afterCount=source.split(p.after).length-1,variants=[p.before,...(p.alternatives||[])];
  if(afterCount>1)fail();
  const hits=variants.map(before=>({before,count:source.split(before).length-1}));
  if(hits.some(h=>h.count>1))fail();
  if(afterCount===1){
   // An old substring wholly inside the reviewed replacement is normal.
   const remainder=source.replace(p.after,'');if(hits.some(h=>remainder.includes(h.before)))fail();continue;
  }
  const found=hits.filter(h=>h.count===1);if(found.length!==1)fail();
  if(p.atStart&&!source.startsWith(found[0].before))fail();
  pending.set(p.file,source.replace(found[0].before,p.after));
 }
 // Validation of every context completes before any file is written.
 for(const [file,source]of pending){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),source);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)patchChannelPoc(process.argv[2],JSON.parse(fs.readFileSync(new URL('./channel-poc-patches.json',import.meta.url),'utf8')));
