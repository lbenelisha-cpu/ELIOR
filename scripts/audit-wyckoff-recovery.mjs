// Read-only: saved trade metadata + public closed candles; never account/trade APIs.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {evaluateWyckoff} from '../lib/wyckoff-strategy.mjs';
import {recoveryComparison} from '../lib/wyckoff-recovery.mjs';
export async function auditRecovery(row,fetcher=fetch){
 const setup=row.wyckoffTrade?.setup||row.setup,at=Date.parse(row.at);
 const result={symbol:row.symbol,at:row.at,entryMode:row.wyckoffTrade?.entryMode||null,source:'RECORDED_TRADE',firstPrice:setup?.rallyHigh?.price??null,secondPrice:setup?.secondRallyHigh?.price??null,passed:null};
 if(setup?.secondRallyHigh)return {...result,...recoveryComparison(setup,at)};
 if(!setup?.rallyHigh||!setup?.secondaryTest||!setup?.initialPeak||!Number.isFinite(at))return {...result,reason:'RECOVERY_NOT_RECORDED'};
 try{
  const start=Math.floor(setup.initialPeak.time/300000)*300000-4*300000;
  if(at-start>1000*300000)throw Error('RECONSTRUCTION_WINDOW_TOO_LONG');
  const url=new URL('https://api.binance.com/api/v3/klines');
  url.search=new URLSearchParams({symbol:row.symbol,interval:'5m',startTime:String(start),endTime:String(at-1),limit:'1000'});
  const response=await fetcher(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('PUBLIC_CANDLES_UNAVAILABLE');
  const raw=await response.json();if(!Array.isArray(raw))throw Error('PUBLIC_CANDLES_UNAVAILABLE');
  const bars=raw.map(x=>({openTime:+x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],closeTime:+x[6]+1,timeframe:'5m',closed:true})).filter(b=>b.closeTime<=at);
  const reconstructed=evaluateWyckoff(bars,{now:at,timeframe:'5m',rollingSearch:true,requireHigherRecovery:true});
  const matches=key=>Math.abs((reconstructed[key]?.time??0)-setup[key].time)<=1&&Math.abs((reconstructed[key]?.price??0)-setup[key].price)<=Math.max(1e-12,setup[key].price*1e-10);
  if(!['initialPeak','rallyHigh','secondaryTest'].every(matches))throw Error('ORIGINAL_PATTERN_NOT_RECONSTRUCTED');
  const comparison=recoveryComparison(reconstructed,at);
  return {...result,...comparison,passed:comparison.secondPrice===null?null:comparison.passed,source:'PUBLIC_CLOSED_CANDLES_AT_ENTRY'};
 }catch(error){return {...result,reason:error.message};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const symbol=process.argv[2]||'SOXSBUSDT';if(!/^[A-Z0-9]{2,30}USDT$/.test(symbol))throw Error('INVALID_SYMBOL');
 const file=process.env.BINANCE_LIVE_LOG_FILE||'/var/data/binance-live-actions.json';
 if(!fs.existsSync(file)){console.log(JSON.stringify({symbol,reason:'LIVE_JOURNAL_MISSING'}));process.exitCode=1;}
 else{
  const rows=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(rows))throw Error('JOURNAL_SCHEMA');
  const buys=rows.filter(r=>r.symbol===symbol&&r.type==='BUY').sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,3);
  if(!buys.length)console.log(JSON.stringify({symbol,reason:'NO_RECORDED_BUY'}));
  for(const row of buys)console.log(JSON.stringify(await auditRecovery(row),null,2));
 }
}
