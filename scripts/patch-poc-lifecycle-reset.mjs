import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function patchPocLifecycleReset(root,release=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),{binanceOnly=false}={}){
 const file='channel-poc-model.js',current=fs.readFileSync(path.join(root,file),'utf8'),next=fs.readFileSync(path.join(release,file),'utf8'),before=fs.readFileSync(path.join(release,'tests/fixtures/channel-poc-before-lifecycle.js'),'utf8');
 const prior=fs.readFileSync(path.join(release,'tests/fixtures/channel-poc-before-fresh-conditions.js'),'utf8');
 const strict=fs.readFileSync(path.join(release,'tests/fixtures/channel-poc-before-reused-channel.js'),'utf8');
 if(current!==before&&current!==prior&&current!==strict&&current!==next)throw Error('Unrecognized '+file+'; no files changed');
 const staged=new Map([[file,next]]);
 const patches=JSON.parse(fs.readFileSync(path.join(release,'scripts/poc-lifecycle-patches.json'),'utf8'));
 for(const p of patches){
  if(binanceOnly&&p.file.startsWith('lib/colmex-'))continue;
  let source=staged.get(p.file)??fs.readFileSync(path.join(root,p.file),'utf8');
  if(source.split(p.after).length===2&&!source.replace(p.after,'').includes(p.before)){staged.set(p.file,source);continue;}
  if(source.split(p.before).length!==2||source.includes(p.after))throw Error('Unrecognized '+p.file+'; no files changed');
  staged.set(p.file,source.replace(p.before,p.after));
 }
 for(const [file,source]of staged)fs.writeFileSync(path.join(root,file),source);
}
if(process.argv[1]===fileURLToPath(import.meta.url))patchPocLifecycleReset(process.argv[2],undefined,{binanceOnly:process.argv.includes('--binance-only')});
