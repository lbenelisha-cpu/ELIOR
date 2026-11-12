import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
// Local read-only readiness diagnostic. Never prints or persists credentials.
const pid=execFileSync('systemctl',['show','levi-binance','-p','MainPID','--value'],{encoding:'utf8'}).trim();
const env=Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
if(!env.BINANCE_CONTROL_TOKEN)throw Error('Control credential not available in service environment');
const r=await fetch('http://127.0.0.1:'+(env.PORT||8080)+'/api/binance-readiness',{headers:{Authorization:'Bearer '+env.BINANCE_CONTROL_TOKEN},signal:AbortSignal.timeout(10000)});
if(!r.ok)throw Error('Readiness HTTP '+r.status);
const {liveState:s}=await r.json();
console.log(JSON.stringify({ready:s.ready,missingProtection:s.missingProtection,pendingOrder:s.pendingOrder,reconciled:s.reconciliation.ready,lastError:s.lastExecutionError},null,2));
