import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
export const directionPatches=JSON.parse(fs.readFileSync(new URL('./direction-confirmation-patches.json',import.meta.url),'utf8'));
export function patchDirectionConfirmation(root,patches=directionPatches){
 const staged=new Map();
 for(const p of patches){
  if(!/^(server\.mjs|lib\/[a-z0-9-]+\.mjs)$/.test(p.file))throw Error('Invalid entry patch path');
  const target=path.join(root,p.file),s=staged.has(p.file)?staged.get(p.file):fs.existsSync(target)?fs.readFileSync(target,'utf8'):null;
  const fail=()=>{throw Error('Unrecognized '+p.file+'; no files changed');};
  if(p.before===null){if(s!==null&&s!==p.after)fail();staged.set(p.file,p.after);continue;}
  if(s===null)fail();
  const next=s.split(p.after).length-1,old=s.split(p.before).length-1;
  if(next===1){if(s.replace(p.after,'').includes(p.before))fail();continue;}
  if(next!==0||old!==1)fail();staged.set(p.file,s.replace(p.before,p.after));
 }
 for(const [f,s]of staged){const target=path.join(root,f);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,s);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)patchDirectionConfirmation(process.argv[2]);
