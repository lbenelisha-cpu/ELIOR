import {preDirectionSource,rewindDirectionFixture} from './pre-direction-source.mjs';
// Historical installer fixtures must use the pre-lifecycle integration anchors.
import fs from 'node:fs';import path from 'node:path';
const patches=JSON.parse(fs.readFileSync(new URL('../../scripts/poc-lifecycle-patches.json',import.meta.url),'utf8'));
export function preLifecycleSource(source,file){
 source=preDirectionSource(source,file);
 for(const p of [...patches].reverse())if(path.basename(p.file)===path.basename(file)&&source.split(p.after).length===2)source=source.replace(p.after,p.before);
 return source;
}
export function rewindLifecycleFixture(root){
 rewindDirectionFixture(root);
 for(const file of new Set(patches.map(p=>p.file))){const target=path.join(root,file);if(fs.existsSync(target))fs.writeFileSync(target,preLifecycleSource(fs.readFileSync(target,'utf8'),file));}
}
