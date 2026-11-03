import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {patchServer} from './patch-channel-primary.mjs';
export function patchIntrabar(root){
 patchServer(root,JSON.parse(fs.readFileSync(new URL('./channel-intrabar-server-patches.json',import.meta.url),'utf8')));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)patchIntrabar(process.argv[2]);
