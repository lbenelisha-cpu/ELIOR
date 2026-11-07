import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export function patchPocFastWatch(root,patches){
 const pending=new Map();
 for(const p of patches){
  if(!/^(?:lib\/[a-z0-9-]+\.mjs|server\.mjs)$/.test(p.file)||!p.after)throw Error('Invalid fast-watch patch');
  const file=path.join(root,p.file),source=pending.get(p.file)??(fs.existsSync(file)?fs.readFileSync(file,'utf8'):null);
  const fail=()=>{throw Error('Unrecognized '+p.file+' ['+p.id+']; no files changed');};
  if(p.before===null){if(source!==null&&source!==p.after)fail();pending.set(p.file,p.after);continue;}
  if(source===null)fail();
  if(p.scope){
   // Status reporting is inserted only in the unique public GET response. Its
   // neighbouring fields belong to local integrations and are not patch anchors.
   if(p.file!=='server.mjs'||p.propertyName!=='pocFastWatch'||!p.scope.start||!p.scope.end||!p.before||!p.installedMarker||p.after!==p.before+p.installedMarker)throw Error('Invalid scoped fast-watch patch');
   if(source.split(p.scope.start).length!==2||source.split(p.scope.end).length!==2)fail();
   const start=source.indexOf(p.scope.start),end=source.indexOf(p.scope.end);
   if(end<=start)fail();
   const scoped=source.slice(start,end);
   if(scoped.split(p.before).length!==2)fail();
   const markers=scoped.split(p.installedMarker).length-1,properties=(scoped.match(/(?:\bpocFastWatch|["']pocFastWatch["'])\s*(?:\]\s*)?:/g)||[]).length;
   if(markers===1&&properties===1)continue; // Retain the original release's field location too.
   if(markers||properties)fail(); // Never overwrite an edited field or create a duplicate key.
   pending.set(p.file,source.slice(0,start)+scoped.replace(p.before,p.after)+source.slice(end));
   continue;
  }
  // A reviewed deployed variant can retain a local configuration hook in its
  // own replacement. Never discard it by forcing every input to one template.
  const variants=[{before:p.before,after:p.after},...(p.alternatives||[]).map(v=>typeof v==='string'?{before:v,after:p.after}:v)];
  if(variants.some(v=>typeof v?.before!=='string'||!v.before||typeof v?.after!=='string'||!v.after))throw Error('Invalid fast-watch variant');
  const updated=[...new Set(variants.map(v=>v.after))].map(after=>({after,count:source.split(after).length-1}));
  if(updated.some(v=>v.count>1))fail();
  const installed=updated.filter(v=>v.count===1);
  if(installed.length>1)fail();
  const hits=variants.map(v=>({...v,count:source.split(v.before).length-1}));
  if(hits.some(h=>h.count>1))fail();
  if(installed.length===1){
   if(p.atStart&&!source.startsWith(installed[0].after))fail();
   // An old substring wholly inside the reviewed replacement is normal.
   const remainder=source.replace(installed[0].after,'');if(hits.some(h=>remainder.includes(h.before)))fail();continue;
  }
  const found=hits.filter(h=>h.count===1);if(found.length!==1)fail();
  if(p.atStart&&!source.startsWith(found[0].before))fail();
  pending.set(p.file,source.replace(found[0].before,found[0].after));
 }
 // Validation of every context completes before any file is written.
 for(const [file,source]of pending){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),source);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)patchPocFastWatch(process.argv[2],JSON.parse(fs.readFileSync(new URL('./poc-fast-watch-patches.json',import.meta.url),'utf8')));
