// Read-only production verification; credentials never leave the local process
// except as the existing Authorization header to this service on loopback.
import fs from 'node:fs';import {execFileSync} from 'node:child_process';
const symbol=process.argv[2];if(!/^[A-Z0-9]{2,24}USDT$/.test(symbol||''))throw Error('Expected a USDT symbol');
const pid=execFileSync('systemctl',['show','levi-binance','-p','MainPID','--value'],{encoding:'utf8'}).trim();
const raw=fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0');
const token=raw.find(x=>x.startsWith('BINANCE_CONTROL_TOKEN='))?.slice('BINANCE_CONTROL_TOKEN='.length);
if(!token)throw Error('Existing control authorization unavailable');
async function get(path){const r=await fetch('http://127.0.0.1:8080/api/binance-'+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('Read failed: '+r.status);return r.json();}
const history=await get('trade-history?symbol='+encodeURIComponent(symbol));
const account=await get('live-account'),agent=await get('agent');
const balance=account.account?.balances?.find(b=>b.asset+'USDT'===symbol),position=agent.agents?.find(a=>a.symbol===symbol);
console.log(JSON.stringify({symbol,source:history.source,complete:history.complete,orders:history.rows?.length,summary:history.summary,
 latestSale:history.rows?.find(r=>r.side==='SELL'),walletEntry:balance?.entryPrice??null,managedEntry:position?.position==='LONG'?position.strategy?.entryPrice:null},null,2));
