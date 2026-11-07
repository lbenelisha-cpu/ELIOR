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
 return fs.readFileSync(file,...args);
}
export const prePocFs={...fs,readFileSync:readPrePocSource};
