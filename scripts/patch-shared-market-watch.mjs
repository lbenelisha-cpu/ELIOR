import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export function patchSharedWatch(root,patches){
 const staged=new Map();
 for(const {file,before,after}of patches){
  if(!['server.mjs','lib/futures-short-runner.mjs','lib/market-attention.mjs'].includes(file))throw Error('Unexpected shared-watch patch target');
  const text=staged.get(file)??fs.readFileSync(path.join(root,file),'utf8');
  if(text.includes(after))continue;
  if(!before||text.split(before).length!==2)throw Error('Unrecognized '+file+' context; no files changed');
  staged.set(file,text.replace(before,after));
 }
 for(const [file,text]of staged)fs.writeFileSync(path.join(root,file),text);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)patchSharedWatch(process.argv[2],JSON.parse(fs.readFileSync(new URL('./shared-market-watch-patches.json',import.meta.url),'utf8')));
