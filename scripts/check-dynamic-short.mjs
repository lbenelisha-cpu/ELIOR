// Read-only deployed account check. Never print credentials or submit/cancel orders.
import fs from 'node:fs';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
const pid=execFileSync('systemctl',['show','levi-binance','-p','MainPID','--value'],{encoding:'utf8'}).trim();
if(!/^[1-9]\d*$/.test(pid))throw Error('SERVICE_NOT_RUNNING');
const env=Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
const {FuturesShortAPI}=await import(pathToFileURL(process.cwd()+'/lib/futures-short-api.mjs'));
const {shortAllocation}=await import(pathToFileURL(process.cwd()+'/lib/futures-short-policy.mjs'));
const api=new FuturesShortAPI({key:env.BINANCE_API_KEY,secret:env.BINANCE_API_SECRET});
const a=await api.get('/fapi/v2/account'),orders=await api.get('/fapi/v1/openOrders'),algos=await api.get('/fapi/v1/openAlgoOrders');
const usdt=a.assets.find(x=>x.asset==='USDT');
const file=env.BINANCE_FUTURES_SHORT_FILE||(env.BINANCE_LIVE_LOG_FILE||'/var/data/binance-live-actions.json')+'.futures-short';
const state=JSON.parse(fs.readFileSync(file,'utf8'));
const allocation=shortAllocation({walletUsdt:Number(usdt.walletBalance),availableUsdt:Number(usdt.availableBalance)},Object.keys(state.positions).length);
const markets=await api.get('/fapi/v1/exchangeInfo'),btc=markets.symbols.find(x=>x.symbol==='BTCUSDT');
console.log(JSON.stringify({allocation,walletUsdt:usdt.walletBalance,availableUsdt:usdt.availableBalance,exchangePositions:a.positions.filter(p=>Number(p.positionAmt)!==0).length,openOrders:orders.length,openAlgos:algos.length,halt:state.halt,pending:!!state.pending,lastRelease:state.haltReleases?.at(-1),btcMinNotional:btc?.filters?.find(f=>f.filterType==='MIN_NOTIONAL')?.notional}));
