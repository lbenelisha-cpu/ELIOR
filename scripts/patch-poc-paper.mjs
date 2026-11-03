import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export function patchPaper(root,patches=JSON.parse(fs.readFileSync(new URL('./poc-paper-patches.json',import.meta.url),'utf8'))){
 const changes=new Map();
 for(const {file,before,after} of patches){
  if(!['server.mjs','binance-agent.html','binance-agent.js','netlify/functions/binance-read-proxy.mjs'].includes(file))throw Error('Unexpected target');
  const source=changes.get(file)??fs.readFileSync(path.join(root,file),'utf8');
  if(source.includes(after))continue;
  if(!before||source.split(before).length!==2)throw Error('Unknown '+file+' context; no files changed');
  changes.set(file,source.replace(before,after));
 }
 for(const [file,source] of changes)fs.writeFileSync(path.join(root,file),source);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)patchPaper(process.argv[2]);
