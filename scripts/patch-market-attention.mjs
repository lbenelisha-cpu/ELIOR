import fs from 'node:fs';
import path from 'node:path';
export function patchAttention(root,patches){
 const changed=new Map();
 for(const {file,before,after} of patches){
  if(!['server.mjs','binance-agent.html'].includes(file))throw Error('Unexpected attention patch target');
  const source=changed.get(file)??fs.readFileSync(path.join(root,file),'utf8');
  if(source.includes(after))continue;
  if(!before||source.split(before).length!==2)throw Error('Unknown '+file+' context; no files changed');
  changed.set(file,source.replace(before,after));
 }
 for(const [file,source] of changed)fs.writeFileSync(path.join(root,file),source);
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)patchAttention(process.argv[2],JSON.parse(fs.readFileSync(new URL('./market-attention-patches.json',import.meta.url),'utf8')));
