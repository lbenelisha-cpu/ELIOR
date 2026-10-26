// Run on the existing VM. Read-only; never print the existing credential.
import fs from 'node:fs';import {execFileSync} from 'node:child_process';
const pid=execFileSync('systemctl',['show','levi-binance','-p','MainPID','--value'],{encoding:'utf8'}).trim();
const token=fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').find(x=>x.startsWith('BINANCE_CONTROL_TOKEN='))?.slice('BINANCE_CONTROL_TOKEN='.length);
if(!token)throw Error('Existing authorization unavailable');
const response=await fetch('http://127.0.0.1:8080/api/binance-equity-history',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
if(!response.ok)throw Error('Equity read failed');const data=await response.json();
console.log(JSON.stringify({source:data.source,day:data.day,timeZone:data.timeZone,summary:data.summary,stale:data.stale,storageError:data.storageError,unpricedAssets:data.unpricedAssets},null,2));
