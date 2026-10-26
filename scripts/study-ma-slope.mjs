// Usage: node scripts/study-ma-slope.mjs <cached public OHLC directory> <report.json>
// Reads fiveRaw only; no account histories, keys or signed/private APIs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {studySlopeExits} from '../lib/ma-slope-research.mjs';
const [directory,output]=process.argv.slice(2);if(!directory||!output)throw Error('Provide input directory and output JSON path');
const symbols=['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','LINKUSDT'];
const variants=[{id:'baseline',thresholdAngle:null,lookbackBars:10},... [5,10].flatMap(lookbackBars=>[-10,0,10].map(thresholdAngle=>({id:`ma20-${lookbackBars}-alpha${thresholdAngle}`,lookbackBars,thresholdAngle})))];
const markets=[],dataManifest=[];
for(const symbol of symbols){
 const raw=JSON.parse(fs.readFileSync(path.join(directory,symbol+'.json'),'utf8')).fiveRaw;if(!Array.isArray(raw))throw Error('Missing fiveRaw: '+symbol);
 const bars=raw.map(r=>({openTime:+r[0],open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[5],closeTime:+r[6],closed:true,timeframe:'5m'}));
 const split=210+Math.floor((bars.length-210)*.7);markets.push({symbol,bars,split});
 dataManifest.push({symbol,bars:bars.length,start:new Date(bars[0].openTime).toISOString(),end:new Date(bars.at(-1).closeTime).toISOString(),testStart:new Date(bars[split].openTime).toISOString(),sha256:crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex')});
}
const compact=r=>Object.fromEntries(Object.entries(r).filter(([k])=>k!=='journal'));
const results=variants.map(variant=>({variant,markets:markets.map(({symbol,bars,split})=>({symbol,training:compact(studySlopeExits(bars,{...variant,endIndex:split})),test:compact(studySlopeExits(bars,{...variant,startIndex:split}))}))}));
const average=(row,part,key)=>row.markets.reduce((s,m)=>s+m[part][key],0)/row.markets.length;
const baseline=results[0],chosen=results.slice(1).sort((a,b)=>average(b,'training','returnPct')-average(a,'training','returnPct'))[0];
const report={version:'MA_SLOPE_RESEARCH_V1',createdAt:new Date().toISOString(),source:'Previously cached Binance Spot public 5-minute OHLC; fixed six-symbol universe',dataManifest,
 assumptions:{feePctPerSide:.1,slippagePctPerSide:.05,entry:'Early-wave branch only; signal on closed bar, fill next open if breakout still valid',exits:'Current stop 1%, activation 5%, trailing gap 1pp. Conservative OHLC checks; peaks update at close. Slope needs two closed observations; execution next open.',split:'Chronological 70% training / 30% holdout, fresh position state in each segment; warmup uses prior bars only',angleScalePctPerMinute:.01,shortTested:false,colmexTested:false},
 chosenUsingTrainingOnly:chosen.variant,summary:{baselineTestMeanReturnPct:average(baseline,'test','returnPct'),chosenTestMeanReturnPct:average(chosen,'test','returnPct'),baselineTestMeanDrawdownPct:average(baseline,'test','maxDrawdownPct'),chosenTestMeanDrawdownPct:average(chosen,'test','maxDrawdownPct')},
 automaticExitEnabled:false,conclusion:'Exploratory only. Does not validate complete live strategy, actual fills, other market regimes, seconds data, Colmex or Futures. No automatic activation.',results};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({chosen:report.chosenUsingTrainingOnly,summary:report.summary,dataManifest},null,2));
