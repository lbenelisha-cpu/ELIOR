// Read-only verification on the existing VM; no credential or account details printed.
import fs from 'node:fs';import {execFileSync} from 'node:child_process';
const pid=execFileSync('systemctl',['show','levi-binance','-p','MainPID','--value'],{encoding:'utf8'}).trim();
const token=fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').find(x=>x.startsWith('BINANCE_CONTROL_TOKEN='))?.slice('BINANCE_CONTROL_TOKEN='.length);
if(!token)throw Error('Existing authorization unavailable');
const url='http://127.0.0.1:8080/api/binance-ma-audit';
if((await fetch(url)).status!==401)throw Error('Audit must remain private');
const response=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
if(!response.ok)throw Error('Audit read failed');const data=await response.json();
if(!data.ok||data.version!=='MA100_200_OBSERVATION_V1'||data.comparisonOnly!==true||!Array.isArray(data.rows)||data.storageError)throw Error('Audit verification failed');
const positionAlphaStatuses={};for(const row of data.rows)if(row.positionAlpha)positionAlphaStatuses[row.positionAlpha.status]=(positionAlphaStatuses[row.positionAlpha.status]||0)+1;
const statuses={};for(const row of data.rows)for(const check of row.checks)statuses[check.status]=(statuses[check.status]||0)+1;
console.log(JSON.stringify({version:data.version,private:true,comparisonOnly:true,startedAt:data.health?.startedAt,lastPersistedAt:data.health?.lastPersistedAt,lastRecordAt:data.health?.lastRecordAt,rows:data.total,pending:data.pending,storageError:data.storageError,maStatuses:statuses,positionAlphaStatuses}));
