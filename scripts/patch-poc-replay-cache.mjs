import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function patchReplayCache(root,release=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')){
 const read=(base,file)=>fs.readFileSync(path.join(base,file),'utf8');
 const oldModel=read(release,'tests/fixtures/channel-poc-before-cache.js'),newModel=read(release,'channel-poc-model.js');
 const model=read(root,'channel-poc-model.js'),server=read(root,'server.mjs');
 if(model!==oldModel&&model!==newModel)throw Error('Unrecognized POC model; no files changed');
 const before='    evals.push(await evaluateSymbol(s));';
 const after=before+'\n    await new Promise(setImmediate); // Let quotes, protections and HTTP reads run between symbols.';
 if(server.split(before).length!==2)throw Error('Unrecognized evaluation loop; no files changed');
 const next=server.includes(after)?server:server.replace(before,after);
 fs.writeFileSync(path.join(root,'channel-poc-model.js'),newModel);
 fs.writeFileSync(path.join(root,'server.mjs'),next);
}
if(process.argv[1]===fileURLToPath(import.meta.url))patchReplayCache(process.argv[2]);
