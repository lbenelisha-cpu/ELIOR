import fs from 'node:fs';
import path from 'node:path';
export function patchFutures(root,patches){
 const sources=new Map();
 for(const {file,before,after} of patches){
  if(!['server.mjs','binance-agent.js'].includes(file))throw Error('Unexpected patch target');
  let s=sources.get(file)??fs.readFileSync(path.join(root,file),'utf8');
  if(s.includes(after))continue;
  if(!before||s.split(before).length!==2)throw Error('Unrecognized '+file+' integration context; no files changed');
  sources.set(file,s.replace(before,after));
 }
 for(const [file,source] of sources)fs.writeFileSync(path.join(root,file),source);
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)patchFutures(process.argv[2],JSON.parse(fs.readFileSync(new URL('./futures-short-patches.json',import.meta.url),'utf8')));
