// Historical installer fixtures must exercise their original allocation release.
// Current shared-policy execution tests read the real runtime directly.
import fs from 'node:fs';import path from 'node:path';
export function rewindSharedPortfolioFixture(root){
 const manifest=JSON.parse(fs.readFileSync(new URL('../../scripts/shared-portfolio-patch.json',import.meta.url),'utf8'));
 for(const item of manifest){const file=path.join(root,item.file);if(item.newFile||!fs.existsSync(file))continue;let s=fs.readFileSync(file,'utf8');for(const h of [...item.hunks].reverse())if(s.split(h.after).length===2)s=s.replace(h.after,h.before);fs.writeFileSync(file,s);}
}
