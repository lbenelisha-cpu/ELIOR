import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function patchHeldChannelStudy(root,release=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')){
 const changes=[];
 for(const name of ['channel-comparison','market-attention']){
  const file='lib/'+name+'.mjs',current=fs.readFileSync(path.join(root,file),'utf8'),next=fs.readFileSync(path.join(release,file),'utf8'),before=fs.readFileSync(path.join(release,'tests/fixtures/'+name+'-before-suspend.mjs'),'utf8');
  if(current!==before&&current!==next)throw Error('Unrecognized '+file+'; no files changed');changes.push([file,next]);
 }
 let server=fs.readFileSync(path.join(root,'server.mjs'),'utf8');
 for(const name of ['recordAttention','observeChannels']){
  const before=name+'(strategyReviewState,{symbol,bars,at:Date.now()});',after=name+'(strategyReviewState,{symbol,bars,at:Date.now(),positionOpen:!!(tradingPositions()[symbol]||futuresShort.state.positions[symbol])});';
  if(server.includes(after))continue;
  if(server.split(before).length!==2)throw Error('Unrecognized observer; no files changed');server=server.replace(before,after);
 }
 changes.push(['server.mjs',server]);
 for(const [file,next] of changes)fs.writeFileSync(path.join(root,file),next);
}
if(process.argv[1]===fileURLToPath(import.meta.url))patchHeldChannelStudy(process.argv[2]);
