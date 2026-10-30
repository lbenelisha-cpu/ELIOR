import fs from 'node:fs';
import path from 'node:path';
import {createNewsCollector} from './market-news.mjs';
export function fileNewsCollector(file){
 return createNewsCollector({
  load(){if(!fs.existsSync(file))return null;const size=fs.statSync(file).size;if(size>4000000)throw Error('NEWS_STORE_TOO_LARGE');return JSON.parse(fs.readFileSync(file,'utf8'));},
  save(data){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(data),{mode:0o600});fs.renameSync(file+'.tmp',file);}
 });
}
