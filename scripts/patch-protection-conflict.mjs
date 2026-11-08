import fs from 'node:fs';
import path from 'node:path';
const patches=JSON.parse(fs.readFileSync(new URL('./protection-conflict-patches.json',import.meta.url),'utf8'));
export function patchProtectionConflict(root){
 const file=path.join(root,'lib/futures-short-runner.mjs');let text=fs.readFileSync(file,'utf8');
 for(const [before,after] of patches){if(text.includes(after))continue;if(text.split(before).length!==2)throw Error('Unrecognized protection runner; no files changed');text=text.replace(before,after);}
 fs.writeFileSync(file,text);
}
if(process.argv[1]===new URL(import.meta.url).pathname)patchProtectionConflict(process.argv[2]);
