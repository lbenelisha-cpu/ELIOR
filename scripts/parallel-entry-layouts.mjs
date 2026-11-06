// Exact historical variant: Binance intrabar release 5381d2cc0db960c8faedef38eb9fb55e8c95b501,
// followed by the targeted settings/consolidation installers. Keep its Binance-only
// history rules; do not add Colmex session handling to an installed Binance module.
const binanceOnlyReplacements=[
 [" const platform=config?.platform==='COLMEX'?'COLMEX':'BINANCE';\n",''],
 ["comparisonBars(bars,now,platform)","comparisonBars(bars,now,'BINANCE')"],
 ["b.closeTime-data[i-1].closeTime!==STEP&&!(platform==='COLMEX'&&stockSessionGap(data[i-1].closeTime,b.closeTime))","b.closeTime-data[i-1].closeTime!==STEP"],
 [" if(platform==='COLMEX'&&!regularSession(signal.openTime))return no('OUTSIDE_REGULAR_SESSION');\n",''],
 ["data.at(-1).closeTime!==signal.openTime&&!(platform==='COLMEX'&&stockSessionGap(data.at(-1).closeTime,signal.openTime+STEP))","data.at(-1).closeTime!==signal.openTime"]
];
export function binanceOnlyShort(source){
 for(const [before,after]of binanceOnlyReplacements){
  if(source.split(before).length!==2)throw Error('Unrecognized reviewed SHORT template');
  source=source.replace(before,after);
 }
 return source;
}
export function parallelPatchVariants(patch){
 const variants=[{name:'shared',before:patch.before,after:patch.after}];
 if(patch.id==='report-import'&&patch.file==='lib/futures-short-policy.mjs'){
  const before="import {validChannelLiveBar} from './channel-live-bar.mjs';\n";
  variants.push({name:'binance-intrabar-import',before,after:"import {conditionCollector,CHANNEL_CONDITIONS_VERSION} from './channel-condition-report.mjs';\n"+before});
 }
 if(patch.id==='independent-short'&&patch.file==='lib/futures-short-policy.mjs')variants.push({name:'binance-intrabar-5381d2c-with-consolidation',before:binanceOnlyShort(patch.before),after:binanceOnlyShort(patch.after)});
 return variants;
}
