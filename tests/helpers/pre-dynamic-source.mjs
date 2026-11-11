// Historical installers retain their reviewed contexts and matching execution tests.
import fs from 'node:fs';import path from 'node:path';
const patches=[...JSON.parse(fs.readFileSync(new URL('../../scripts/dynamic-short-patches.json',import.meta.url),'utf8')),...JSON.parse(fs.readFileSync(new URL('../fixtures/pre-dynamic/ui-patches.json',import.meta.url),'utf8'))];
export function preDynamicSource(source,file){
 if(path.basename(file)==='binance-agent.html')source=source.replace('/binance-agent.js?v=20261111-unified','/binance-agent.js?v=20261111-dynamic-short');
 for(const p of [...patches].reverse())if(path.basename(p.file)===path.basename(file)&&source.split(p.after).length===2)source=source.replace(p.after,p.before);
 return source;
}
export function rewindDynamicFixture(root){
 for(const file of new Set(patches.map(p=>p.file))){const target=path.join(root,file);if(fs.existsSync(target))fs.writeFileSync(target,preDynamicSource(fs.readFileSync(target,'utf8'),file));}
 fs.cpSync(new URL('../fixtures/pre-dynamic/tests/',import.meta.url),path.join(root,'tests'),{recursive:true});
}
export const preDynamicFs={...fs,readFileSync(file,...args){const s=fs.readFileSync(file,...args);return typeof s==='string'?preDynamicSource(s,file instanceof URL?file.pathname:file):s;}};
