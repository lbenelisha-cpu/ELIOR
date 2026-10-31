// Narrow, fail-closed patch of the installed engine; never replace trading code.
import fs from 'node:fs';
import path from 'node:path';
export function patch(root){
 const file=path.join(root,'server.mjs'),reportFile=path.join(root,'lib/strategy-followup.mjs');
 let server=fs.readFileSync(file,'utf8'),report=fs.readFileSync(reportFile,'utf8');
 const once=(source,old,next)=>{if(source.includes(next))return source;if(source.split(old).length!==2)throw Error('Installed observer differs; no files changed');return source.replace(old,next);};
 if(!server.includes("import {observeChannels} from './lib/channel-comparison.mjs';"))server="import {observeChannels} from './lib/channel-comparison.mjs';\n"+server;
 server=once(server,'const bars=await candles(symbol);observeEntryComparison','const bars=await candles(symbol);observeChannels(strategyReviewState,{symbol,bars,at:Date.now()});observeEntryComparison');
 server=once(server,'new Set([...SYMBOLS,...open])','new Set([...SYMBOLS,...open,...Object.keys(strategyReviewState.channelComparison?.pending||{})])');
 for(const asset of ['resistance-patterns','regression-trend','parallel-channel']){
  const route="    '/"+asset+".js':['"+asset+".js','text/javascript'],";
  if(!server.includes(route)){if(server.includes("'/"+asset+".js'"))throw Error('Conflicting asset route');server=once(server,'  const sf={','  const sf={\n'+route);}
 }
 if(!report.includes("import {channelReport} from './channel-comparison.mjs';"))report="import {channelReport} from './channel-comparison.mjs';\n"+report;
 report=once(report,'return {startedAt:r?.startedAt','return {channelComparison:channelReport(state),startedAt:r?.startedAt');
 fs.writeFileSync(file,server);fs.writeFileSync(reportFile,report);
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)patch(process.argv[2]);
