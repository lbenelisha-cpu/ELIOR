import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Patch only the observer and the reviewed audit module. Unknown server
// integration contexts or locally modified audit modules fail before writes.
export function patchAuditTimestamps(root,release){
 const file='lib/ma-decision-audit.mjs';
 const replacement=fs.readFileSync(path.join(release,file),'utf8');
 const helper=replacement.match(/\/\/ Binance sends ISO source timestamps;[^]*?\n};\n/);
 const normalize=' priceAt=sourceTime(priceAt);\n';
 if(!helper||replacement.split(normalize).length!==2)throw Error('Invalid audit timestamp release');
 const previous=replacement.replace(helper[0],'').replace(normalize,'');
 const installed=fs.readFileSync(path.join(root,file),'utf8');
 if(installed!==replacement&&installed!==previous)throw Error('Unrecognized audit module; no files changed');
 const old='priceAt:Number(streams[event.symbol]?.lastEventAt),...details';
 const next='priceAt:streams[event.symbol]?.lastEventAt,...details';
 let server=fs.readFileSync(path.join(root,'server.mjs'),'utf8');
 if(server.split(old).length===2&&!server.includes(next))server=server.replace(old,next);
 else if(server.includes(old)||server.split(next).length!==2)throw Error('Unrecognized Binance observer; no files changed');
 fs.writeFileSync(path.join(root,file),replacement);
 fs.writeFileSync(path.join(root,'server.mjs'),server);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)patchAuditTimestamps(process.argv[2],process.argv[3]);
