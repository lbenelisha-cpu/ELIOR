import {preDynamicSource} from './pre-dynamic-source.mjs';
import {preLifecycleSource} from './pre-lifecycle-source.mjs';
// Immutable 05eedc48 sources for historical installers. Those installers must keep
// recognizing their original releases even after the current entry policy changes.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),fixtures=fileURLToPath(new URL('../fixtures/pre-poc/',import.meta.url));
export function readPrePocSource(file,...args){
 const original=file instanceof URL?fileURLToPath(file):file;
 if(typeof original==='string'){
  const relative=path.relative(root,path.resolve(original)),candidate=path.join(fixtures,relative);
  if(relative.startsWith('lib/')&&fs.existsSync(candidate))return fs.readFileSync(candidate,...args);
 }
 let data=fs.readFileSync(file,...args);
 if(typeof data==='string')data=preDynamicSource(data,typeof original==='string'?original:'');
 if(typeof data!=='string')return data;
 const basename=typeof original==='string'?path.basename(original):'';
 if(!['server.mjs','futures-short-runner.mjs','wyckoff-five-minute-data.mjs'].includes(basename))return data;
 const patches=JSON.parse(fs.readFileSync(new URL('../../scripts/poc-fast-watch-patches.json',import.meta.url),'utf8'));
 // Reverse only exact reviewed additions for legacy installer fixtures, including
 // their temporary copies. Current trading tests use node:fs directly.
 let text=preLifecycleSource(data,basename);
 for(const p of [...patches].reverse())if(p.before&&path.basename(p.file)===basename){
  if(p.scope&&text.split(p.installedMarker).length===2)text=text.replace(p.installedMarker,'');
  else if(text.split(p.after).length===2)text=text.replace(p.after,p.before);
 }
 return text;
}
export const prePocFs={...fs,readFileSync:readPrePocSource};
