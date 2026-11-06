import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export function patchSharedWatch(root,patches){
 const staged=new Map();
 for(const [index,patch]of patches.entries()){
  const {file,before,after,alternatives=[]}=patch;
  if(!['server.mjs','lib/futures-short-runner.mjs','lib/market-attention.mjs'].includes(file))throw Error('Unexpected shared-watch patch target');
  const text=staged.get(file)??fs.readFileSync(path.join(root,file),'utf8');
  const variants=[{before,after},...alternatives];
  const count=fragment=>typeof fragment==='string'&&fragment.length?text.split(fragment).length-1:0;
  const fail=reason=>{throw Error('Unrecognized '+file+' context ['+(patch.id||'patch-'+(index+1))+'; '+reason+']; no files changed');};
  if(variants.some(v=>!v.before||!v.after))fail('empty anchor');
  const installed=variants.map(v=>count(v.after));
  if(installed.some(n=>n>1)||installed.filter(n=>n===1).length>1)fail('duplicate installed integration');
  if(installed.some(n=>n===1))continue;
  // Prefer the original anchor. A reviewed fallback supports deployments that
  // have the SHORT runner but not the optional POC reservation integration.
  // Never fall back from an ambiguous anchor or normalize/replace whole files.
  let selected;
  for(const variant of variants){
   const matches=count(variant.before);
   if(matches>1)fail('duplicate anchor');
   if(matches===1){selected=variant;break;}
  }
  if(!selected)fail('missing anchor');
  staged.set(file,text.replace(selected.before,selected.after));
 }
 for(const [file,text]of staged)fs.writeFileSync(path.join(root,file),text);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)patchSharedWatch(process.argv[2],JSON.parse(fs.readFileSync(new URL('./shared-market-watch-patches.json',import.meta.url),'utf8')));
