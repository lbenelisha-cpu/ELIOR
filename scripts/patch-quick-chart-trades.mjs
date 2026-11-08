import fs from 'node:fs';
import path from 'node:path';
const patches=JSON.parse(fs.readFileSync(new URL('./quick-chart-trades-patches.json',import.meta.url),'utf8'));
export function patchQuickTrades(root){
 const staged=new Map();
 for(const p of patches){let t=staged.get(p.file)??fs.readFileSync(path.join(root,p.file),'utf8');if(t.includes(p.after))continue;if(t.split(p.before).length!==2)throw Error('Unrecognized '+p.file+'; no files changed');staged.set(p.file,t.replace(p.before,p.after));}
 for(const [file,t] of staged)fs.writeFileSync(path.join(root,file),t);
}
if(process.argv[1]===new URL(import.meta.url).pathname)patchQuickTrades(process.argv[2]);
