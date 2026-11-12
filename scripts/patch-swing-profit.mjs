import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(process.argv[2]||'.'),release=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const patches=JSON.parse(fs.readFileSync(path.join(release,'scripts/swing-profit-patches.json'),'utf8')),staged=new Map();
const count=(s,x)=>s.split(x).length-1;
for(const p of patches){
 const file=path.join(root,p.file),text=staged.get(file)??fs.readFileSync(file,'utf8');
 if(count(text,p.after)===1){staged.set(file,text);continue;}
 if(count(text,p.before)!==1)throw Error('Unknown runtime '+p.file+' ['+p.id+']; no files changed');
 staged.set(file,text.replace(p.before,p.after));
}
const module='lib/swing-profit-protection.mjs',content=fs.readFileSync(path.join(release,module),'utf8'),target=path.join(root,module);
if(fs.existsSync(target)&&fs.readFileSync(target,'utf8')!==content)throw Error('Unknown swing module; no files changed');
staged.set(target,content);
for(const [file,text]of staged)fs.writeFileSync(file,text);
console.log('Five-wave exit staged; existing positions and unrelated runtime guards retained.');
