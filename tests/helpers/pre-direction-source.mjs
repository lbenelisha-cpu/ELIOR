// Historical installers are tested with their historical policy and matching tests.
// Current entry/runner tests import the live modules directly.
import fs from 'node:fs';import path from 'node:path';
const patches=JSON.parse(fs.readFileSync(new URL('../../scripts/direction-confirmation-patches.json',import.meta.url),'utf8'));
export function preDirectionSource(source,file){
 for(const p of [...patches].reverse())if(p.before&&path.basename(p.file)===path.basename(file)&&source.split(p.after).length===2)source=source.replace(p.after,p.before);
 return source;
}
export function rewindDirectionFixture(root){
 for(const file of new Set(patches.filter(p=>p.before).map(p=>p.file))){const target=path.join(root,file);if(fs.existsSync(target))fs.writeFileSync(target,preDirectionSource(fs.readFileSync(target,'utf8'),file));}
 const oldTests=new URL('../fixtures/pre-direction/tests/',import.meta.url);
 fs.cpSync(oldTests,path.join(root,'tests'),{recursive:true});
}
