import fs from 'node:fs';
import path from 'node:path';
const allowed=new Set(['server.mjs','binance-agent.js','binance-agent.html','lib/futures-short-policy.mjs','lib/futures-short-runner.mjs']);
export function patchPoc(root,patches){
 const changed=new Map();
 for(const {file,before,after} of patches){
  if(!allowed.has(file))throw Error('Unexpected POC patch target');
  let source=changed.get(file)??fs.readFileSync(path.join(root,file),'utf8');
  if(source.includes(after))continue;
  if(!before||source.split(before).length!==2)throw Error('Unknown '+file+' context; no files changed');
  changed.set(file,source.replace(before,after));
 }
 for(const [file,source] of changed)fs.writeFileSync(path.join(root,file),source);
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)patchPoc(process.argv[2],JSON.parse(fs.readFileSync(new URL('./binance-poc-patches.json',import.meta.url),'utf8')));
