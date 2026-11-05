import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export function patchShortSettings(root,patches){
 const sources=new Map();
 for(const {file,before,after} of patches){
  if(!['server.mjs','lib/futures-short-policy.mjs','lib/futures-short-runner.mjs'].includes(file))throw Error('Unexpected patch target');
  const s=sources.get(file)??fs.readFileSync(path.join(root,file),'utf8');
  if(s.includes(after))continue;
  if(!before||s.split(before).length!==2)throw Error('Unrecognized '+file+' context; no files changed');
  sources.set(file,s.replace(before,after));
 }
 for(const [file,source] of sources)fs.writeFileSync(path.join(root,file),source);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 patchShortSettings(process.argv[2],JSON.parse(fs.readFileSync(new URL('./short-settings-exit-patches.json',import.meta.url),'utf8')));
}
