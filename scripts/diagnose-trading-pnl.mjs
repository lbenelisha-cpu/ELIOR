// Read the authenticated local reporting endpoint; never print credentials.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
try{
 const pid=execFileSync('systemctl',['show','levi-binance','-p','MainPID','--value'],{encoding:'utf8'}).trim();
 if(!/^[1-9]\d*$/.test(pid))throw Error('SERVICE_NOT_RUNNING');
 const env=fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0'),token=env.find(x=>x.startsWith('BINANCE_CONTROL_TOKEN='))?.slice('BINANCE_CONTROL_TOKEN='.length);
 if(!token)throw Error('REPORT_AUTH_UNAVAILABLE');
 const r=await fetch('http://127.0.0.1:8080/api/binance-trading-pnl',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)}),d=await r.json();
 if(!r.ok||!d.ok)throw Error('REPORT_READ_FAILED');
 const summary=direction=>{const rows=d.rows.filter(r=>!direction||r.direction===direction),known=rows.filter(r=>r.netPnlUsdt!==null);return {rows:rows.length,known:known.length,unknown:rows.length-known.length,netUsdt:known.length?known.reduce((n,r)=>n+r.netPnlUsdt,0):null};};
 console.log(JSON.stringify({readOnly:true,loadingShort:d.loadingShort,health:d.health,LONG:summary('LONG'),SHORT:summary('SHORT'),TOTAL:summary(),unknown:d.rows.filter(r=>r.issue).map(r=>({symbol:r.symbol,direction:r.direction,issue:r.issue})),latestShort:d.rows.filter(r=>r.direction==='SHORT').slice(0,3).map(r=>({symbol:r.symbol,netPnlUsdt:r.netPnlUsdt,closedAt:r.closedAt}))},null,2));
}catch(e){console.log(JSON.stringify({error:/^[A-Z_]+$/.test(e.message)?e.message:'REPORT_CHECK_FAILED'}));process.exitCode=1;}
