import fs from 'node:fs';
import path from 'node:path';
export function patchServer(root,patches){
 const file=path.join(root,'server.mjs');let source=fs.readFileSync(file,'utf8');
 for(const {before,after} of patches){
  if(source.includes(after))continue;
  if(!before||source.split(before).length!==2)throw Error('Installed server differs at channel-entry integration. No files changed.');
  source=source.replace(before,after);
 }
 fs.writeFileSync(file,source);
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)patchServer(process.argv[2],JSON.parse(fs.readFileSync(new URL('./channel-primary-server-patches.json',import.meta.url),'utf8')));
