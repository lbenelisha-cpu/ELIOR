// Offline, read-only candle study. Input must include at least 204 warm-up bars.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {observeEntryComparison,entryComparisonReport,comparisonBars} from '../lib/entry-method-comparison.mjs';
export function replayEntryMethods(input){
 const {platform,settings={},costs,markets}=input,start=Date.parse(input.startAt),end=Date.parse(input.endAt);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||!Array.isArray(markets)||!markets.length||markets.length>150)throw Error('INVALID_REPLAY_INPUT');
 const state={},universe=markets.map(m=>m.symbol);
 if(new Set(universe).size!==universe.length||universe.some(s=>typeof s!=='string'||!/^[A-Z0-9.-]{1,30}$/.test(s)))throw Error('INVALID_REPLAY_SYMBOLS');
 const series=markets.map(m=>({...m,bars:comparisonBars(m.bars,end,platform)}));
 for(const market of series){
  const prefix=market.bars.filter(b=>b.closeTime<=start);
  if(prefix.length<204)throw Error('INSUFFICIENT_WARMUP_'+market.symbol);
  observeEntryComparison(state,{symbol:market.symbol,bars:prefix,at:start,platform,settings,costs,universe});
 }
 const events=series.flatMap(m=>m.bars.map((b,i)=>({symbol:m.symbol,bars:m.bars,index:i,at:b.closeTime})).filter(e=>e.at>start&&e.at<=end)).sort((a,b)=>a.at-b.at||a.symbol.localeCompare(b.symbol));
 for(const e of events)observeEntryComparison(state,{symbol:e.symbol,bars:e.bars.slice(0,e.index+1),at:e.at,platform,settings,costs,universe});
 return {type:'OFFLINE_EQUAL_RISK_TRADE_STUDY_NOT_PORTFOLIO_RETURN',startAt:input.startAt,endAt:input.endAt,coverage:series.map(m=>({symbol:m.symbol,first:m.bars[0]?.openTime,last:m.bars.at(-1)?.closeTime,bars:m.bars.length})),report:entryComparisonReport(state)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.argv[2])throw Error('Usage: node scripts/compare-entry-methods.mjs candles.json');
 console.log(JSON.stringify(replayEntryMethods(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))),null,2));
}
