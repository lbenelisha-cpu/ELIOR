import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
const patches=JSON.parse(fs.readFileSync(new URL('./current-equity-allocation-patches.json',import.meta.url),'utf8'));
export const equityAllocationFiles=[...new Set(patches.map(p=>p.file))];
export function patchCurrentEquityAllocation(root){
 const staged=new Map();
 for(const file of equityAllocationFiles){
  if(!fs.existsSync(path.join(root,file)))throw Error('Missing '+file+'; no files changed');
  staged.set(file,fs.readFileSync(path.join(root,file),'utf8'));
 }
 for(const p of patches){
  let source=staged.get(p.file);
  const fail=()=>{throw Error('Unrecognized '+p.file+' ['+p.id+']; no files changed');};
  if(p.fragment){
   const before=source.split(p.before).length-1,after=source.split(p.after).length-1;
   if(after===1&&before===0)continue;
   if(before!==1||after!==0)fail();
   source=source.replace(p.before,p.after);
  }else{
   if(source===p.after)continue;
   const alternatives=p.alternatives||[];
   if(!Array.isArray(alternatives)||alternatives.some(v=>typeof v!=='string'||!v))fail();
   if(source!==p.before&&!alternatives.includes(source))fail();
   source=p.after;
  }
  staged.set(p.file,source);
 }
 // Validate every integration before writing any file in the private runtime stage.
 for(const [file,source] of staged)fs.writeFileSync(path.join(root,file),source);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)patchCurrentEquityAllocation(process.argv[2]);
