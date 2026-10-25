import fs from 'node:fs';
import path from 'node:path';
// Durable rejection boundaries: failed storage must prevent evaluation, not revive an old setup.
export function createSearchBoundaries(file){
 let state=null;
 function load(){
  if(state)return;
  state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
  if(!state||typeof state!=='object'||Array.isArray(state)||Object.values(state).some(v=>!Number.isFinite(v)||v<0)){state=null;throw Error('INVALID_SEARCH_BOUNDARIES');}
 }
 return {
  get(key){load();return state[key]||0;},
  advance(key,time){load();if(!Number.isFinite(time)||time<=0)throw Error('INVALID_SEARCH_BOUNDARY');
   if(time<=(state[key]||0))return;
   const next={...state,[key]:time};fs.mkdirSync(path.dirname(file),{recursive:true});
   fs.writeFileSync(file+'.tmp',JSON.stringify(next),{mode:0o600});fs.renameSync(file+'.tmp',file);state=next;
  }
 };
}
