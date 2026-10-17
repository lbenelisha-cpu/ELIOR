// Usage: node scripts/binance-exit-study.mjs ACTION_LOG_JSON CANDLE_DIRECTORY OUTPUT_HTML
// Candle directory contains SYMBOL.json read-only /api/binance-chart 5m responses.
import fs from 'node:fs';
import {simulateExit,EXIT_STUDY_VARIANTS} from '../lib/exit-study.mjs';
const [journal,directory,output]=process.argv.slice(2);
if(!journal||!directory||!output)throw Error('Usage: journal.json candles_directory output.html');
const entries=JSON.parse(fs.readFileSync(journal)).live.filter(x=>x.type==='BUY'&&x.status==='FILLED').sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)),split=Math.floor(entries.length*2/3);
const candleMap=new Map(entries.map(e=>[e.symbol,JSON.parse(fs.readFileSync(directory+'/'+e.symbol+'.json')).candles]));
const sum=rows=>({n:rows.length,net:rows.reduce((a,r)=>a+r.net,0),meanPct:rows.length?rows.reduce((a,r)=>a+r.netPct,0)/rows.length:null,exits:rows.filter(r=>r.exit.reason!=='HORIZON_MARK').length,wins:rows.filter(r=>r.net>0).length});
const results=EXIT_STUDY_VARIANTS.map(variant=>{
 const trades=entries.map((e,i)=>({...simulateExit(e,candleMap.get(e.symbol),variant),group:i<split?'discovery':'later'}));
 if(trades.some(t=>!t.covered))throw Error('Incomplete candle coverage: do not silently change the cohort');
 return {variant,...sum(trades),discovery:sum(trades.filter(t=>t.group==='discovery')),later:sum(trades.filter(t=>t.group==='later')),trades};
});
const paths=entries.map(e=>{const at=Date.parse(e.at),path=candleMap.get(e.symbol).filter(b=>b.closed!==false&&b.openTime>at&&b.closeTime<=at+86400000);return {start:path[0].closeTime,step:300000,values:path.map(b=>Number(b.close))};});
for(const r of results)for(const t of r.trades)delete t.observed;
for(const r of results.slice(1))r.trades=r.trades.map(({exit,net,netPct,peakPrice,peakAt})=>({exit,net,netPct,peakPrice,peakAt}));
const sensitivity=[[.001,.0005],[.001,.001],[.0015,.001],[.002,.002]].map(([feeRate,exitSlippage])=>({feeRate,exitSlippage,net:entries.reduce((total,e)=>total+simulateExit(e,candleMap.get(e.symbol),EXIT_STUDY_VARIANTS[1],{feeRate,exitSlippage}).net,0)}));
const data={generatedAt:new Date().toISOString(),split,entries:entries.length,results,paths,sensitivity};
const template=fs.readFileSync(new URL('../reports/binance-exit-study-20261017.html',import.meta.url),'utf8');
fs.writeFileSync(output,template.replace(/const DATA=.*?;const \$=/s,'const DATA='+JSON.stringify(data).replace(/</g,'\\u003c')+';const $='));
console.log(JSON.stringify(results.map(({trades,...r})=>r),null,2));
