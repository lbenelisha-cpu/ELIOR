// Read only. Reuse the running service's existing authorization locally;
// never print credentials or call an exchange/trading mutation.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const pid=execFileSync('systemctl',['show','levi-binance','-p','MainPID','--value'],{encoding:'utf8'}).trim();
if(!/^[1-9][0-9]*$/.test(pid))throw Error('Service is not running');
const env=fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0');
const token=env.find(x=>x.startsWith('BINANCE_CONTROL_TOKEN='))?.slice('BINANCE_CONTROL_TOKEN='.length);
if(!token)throw Error('Existing control authorization unavailable');
const url='http://127.0.0.1:8080/api/binance-poc-paper';
const denied=await fetch(url,{signal:AbortSignal.timeout(5000)});
if(denied.status!==401)throw Error('Private paper endpoint must require authentication');
const response=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
if(response.status!==200)throw Error('Authenticated paper endpoint unavailable: '+response.status);
const data=await response.json();
if(data.version!=='POC_PAPER_V1'||!data.ok||data.executionEnabled!==false)throw Error('Unexpected paper response');
console.log(JSON.stringify({version:data.version,executionEnabled:data.executionEnabled,
 lastCycle:new Date(data.lastCycle).toISOString(),cycleAgeSeconds:Math.round((Date.now()-data.lastCycle)/1000),
 scanCount:data.scanCount,issues:data.issues,
 accounts:data.accounts.map(a=>({side:a.side,status:a.status,realEquity:a.live?.equity,realFree:a.live?.free,
 seed:a.seed,startedAt:a.startedAt?new Date(a.startedAt).toISOString():null,demoEquity:a.equity,
 demoPnl:a.totalPnl,open:a.positions?.length,closed:a.closedCount,pending:a.pending?.length}))},null,2));
