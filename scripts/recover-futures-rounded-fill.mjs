// Run explicitly with --release after installing the fill-price fix.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {FuturesShortAPI} from '../lib/futures-short-api.mjs';
import {atomicFuturesSave} from '../lib/futures-short-runner.mjs';
import {prepareRoundedFillRecovery} from '../lib/futures-short-ownership-recovery.mjs';

if(process.argv[2]!=='--release')throw Error('Explicit --release required');
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const installed=fs.readFileSync(path.join(root,'lib/futures-short-runner.mjs'),'utf8');
if(!installed.includes('const entryPrice=futuresFillPrice(order);'))throw Error('SHORT_FILL_PRICE_FIX_NOT_INSTALLED');
const service='levi-binance';
const ctl=(...args)=>execFileSync('systemctl',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000});
const pid=ctl('show',service,'-p','MainPID','--value').trim();
if(!/^[1-9]\d*$/.test(pid))throw Error('SERVICE_NOT_RUNNING');
const env=Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`,'utf8').split('\0').map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
const api=new FuturesShortAPI({key:env.BINANCE_API_KEY,secret:env.BINANCE_API_SECRET});
const file=env.BINANCE_FUTURES_SHORT_FILE||(env.BINANCE_LIVE_LOG_FILE||'/var/data/binance-live-actions.json')+'.futures-short';
const before=fs.readFileSync(file,'utf8');
await prepareRoundedFillRecovery(JSON.parse(before),api);
// Stop the writer, then repeat the exchange checks before changing the journal.
ctl('stop',service);
let saved=false;
try{
 if(ctl('show',service,'-p','MainPID','--value').trim()!=='0')throw Error('SERVICE_STOP_NOT_CONFIRMED');
 const current=fs.readFileSync(file,'utf8');if(current!==before)throw Error('SHORT_JOURNAL_CHANGED');
 const next=await prepareRoundedFillRecovery(JSON.parse(current),api);
 const backup=file+'.before-fill-price-recovery-'+Date.now();
 fs.writeFileSync(backup,current,{flag:'wx',mode:0o600});
 atomicFuturesSave(file,next);saved=true;
 console.log(JSON.stringify({released:true,previousHalt:'FUTURES_POSITION_OWNERSHIP_CHANGED',resumedAt:next.resumedAt,backup,exchangeOrdersSubmitted:0,budgetUnchanged:true}));
}finally{
 // Restart even when validation fails; the pre-existing halt then remains intact.
 try{ctl('start',service);}catch{
  console.error(saved?'SERVICE_RESTART_FAILED_AFTER_RELEASE':'SERVICE_RESTART_FAILED_WITH_HALT_RETAINED');process.exitCode=1;
 }
}
