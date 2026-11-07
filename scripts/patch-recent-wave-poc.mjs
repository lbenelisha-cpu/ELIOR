import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {patchPocFastWatch} from './patch-poc-fast-watch.mjs';
const manifest=JSON.parse(fs.readFileSync(new URL('./recent-wave-poc-patches.json',import.meta.url),'utf8'));
const fast=JSON.parse(fs.readFileSync(new URL('./poc-fast-watch-patches.json',import.meta.url),'utf8'));
export const recentWaveFiles=[...new Set([...fast,...manifest].map(p=>p.file))];
export function patchRecentWavePoc(root){
 const stage=fs.mkdtempSync(path.join(os.tmpdir(),'levi-wave-stage-'));
 try{
  for(const file of recentWaveFiles){const source=path.join(root,file);if(fs.existsSync(source)){fs.mkdirSync(path.dirname(path.join(stage,file)),{recursive:true});fs.copyFileSync(source,path.join(stage,file));}}
  // Normalize only reviewed new versions INSIDE a private stage. This permits
  // reinstallation without making older patchers accept unknown runtime code.
  for(const p of manifest){
   const file=path.join(stage,p.file);if(!fs.existsSync(file))throw Error('Missing '+p.file+'; no files changed');
   let source=fs.readFileSync(file,'utf8');
   if(p.fragment){if(source.split(p.after).length===2)source=source.replace(p.after,p.before);if(source.split(p.before).length!==2)throw Error('Unknown '+p.file+' wave context; no files changed');}
   else {if(source===p.after)source=p.before;if(source!==p.before)throw Error('Unknown '+p.file+' wave version; no files changed');}
   fs.writeFileSync(file,source);
  }
  patchPocFastWatch(stage,fast);
  for(const p of manifest){const file=path.join(stage,p.file),source=fs.readFileSync(file,'utf8');
   if(p.fragment?source.split(p.before).length!==2:source!==p.before)throw Error('Changed staged '+p.file+'; no files changed');
   fs.writeFileSync(file,p.fragment?source.replace(p.before,p.after):p.after);
  }
  for(const file of recentWaveFiles){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.copyFileSync(path.join(stage,file),path.join(root,file));}
 }finally{fs.rmSync(stage,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)patchRecentWavePoc(process.argv[2]);
