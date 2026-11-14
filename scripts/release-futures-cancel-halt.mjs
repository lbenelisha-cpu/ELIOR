// Explicit operator recovery; Binance access is GET-only. Default is a dry check.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const HALT='FUTURES_PROTECTION_CANCEL_PENDING';
export async function verifyCancelRecovery(s,api){
 if(s?.version!=='FUTURES_CHANNEL_SHORT_V1'||s.halt!==HALT||s.pending!==null||!s.positions||Array.isArray(s.positions)||Object.keys(s.positions).length||!Array.isArray(s.closed)||!s.closed.length||!Array.isArray(s.used)||!Number.isFinite(s.startedAt))throw Error('JOURNAL_NOT_SAFE');
 const last=s.closed.at(-1);
 if(!/^[A-Z0-9]+USDT$/.test(last.symbol)||!Number.isFinite(last.closedAt)||last.closedAt>Date.now()||!Array.isArray(last.algos)||!last.algos.length)throw Error('INCIDENT_NOT_IDENTIFIED');
 const a=await api.get('/fapi/v2/account'),m=await api.get('/fapi/v1/positionSide/dual');
 if(a.canTrade!==true||a.multiAssetsMargin!==false||m.dualSidePosition!==false||!Array.isArray(a.positions)||a.positions.some(p=>p.positionAmt==null||p.positionAmt===''||!Number.isFinite(Number(p.positionAmt))||Number(p.positionAmt)!==0))throw Error('ACCOUNT_NOT_FLAT_OR_UNVERIFIED');
 for(const route of ['/fapi/v1/openOrders','/fapi/v1/openAlgoOrders']){const rows=await api.get(route);if(!Array.isArray(rows)||rows.length)throw Error('OPEN_ORDERS_REMAIN');}
 const verified=[];
 for(const ref of last.algos){
  if(!ref.clientAlgoId||!['STOP_MARKET','TAKE_PROFIT_MARKET'].includes(ref.kind))throw Error('INVALID_PROTECTION_REFERENCE');
  const query=ref.algoId?{algoId:ref.algoId}:{clientAlgoId:ref.clientAlgoId};
  const o=await api.get('/fapi/v1/algoOrder',query);
  if(o.symbol!==last.symbol||o.clientAlgoId!==ref.clientAlgoId||o.side!=='BUY'||o.positionSide!=='BOTH'||o.orderType!==ref.kind||![true,'true'].includes(o.closePosition)||!['CANCELED','EXPIRED','FINISHED','REJECTED'].includes(o.algoStatus))throw Error('PROTECTION_NOT_TERMINAL');
  verified.push({clientAlgoId:ref.clientAlgoId,status:o.algoStatus});
 }
 return {symbol:last.symbol,closedAt:last.closedAt,verified};
}
async function main(){
 const mode=process.argv[2]||'--check';if(!['--check','--release'].includes(mode))throw Error('INVALID_MODE');
 const root=process.cwd(),service='levi-binance';
 const ctl=(...args)=>execFileSync('systemctl',args,{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}).trim();
 const pid=ctl('show',service,'-p','MainPID','--value');if(!/^[1-9]\d*$/.test(pid))throw Error('SERVICE_NOT_RUNNING');
 const env=Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
 const file=env.BINANCE_FUTURES_SHORT_FILE||(env.BINANCE_LIVE_LOG_FILE||'/var/data/binance-live-actions.json')+'.futures-short';
 const {FuturesShortAPI}=await import(pathToFileURL(path.join(root,'lib/futures-short-api.mjs')));
 const api=new FuturesShortAPI({key:env.BINANCE_API_KEY,secret:env.BINANCE_API_SECRET});
 const before=fs.readFileSync(file,'utf8'),s=JSON.parse(before);
 console.log(JSON.stringify({stage:'JOURNAL',halt:s.halt,symbol:s.closed?.at(-1)?.symbol,closedAt:s.closed?.at(-1)?.closedAt,algos:s.closed?.at(-1)?.algos}));
 const evidence=await verifyCancelRecovery(s,api);
 console.log(JSON.stringify({check:'PASSED',halt:s.halt,...evidence,openPositions:0,openOrders:0,openAlgoOrders:0,exchangeWrites:0}));
 if(mode==='--check')return;
 const installed=fs.readFileSync(path.join(root,'lib/futures-short-runner.mjs'),'utf8');
 if(!installed.includes('this.state.resumedAt||0'))throw Error('FRESH_SIGNAL_GUARD_MISSING');
 ctl('stop',service);
 try{
  if(ctl('show',service,'-p','MainPID','--value')!=='0')throw Error('SERVICE_NOT_STOPPED');
  const current=fs.readFileSync(file,'utf8');if(current!==before)throw Error('JOURNAL_CHANGED_RECHECK_REQUIRED');
  const checked=await verifyCancelRecovery(JSON.parse(current),api),next=JSON.parse(current),now=Date.now();
  next.haltReleases=[...(next.haltReleases||[]),{at:now,previousHalt:HALT,...checked,journalSha256:createHash('sha256').update(current).digest('hex')}].slice(-100);
  next.resumedAt=now;next.halt=null;
  const backup=file+'.before-cancel-release-'+now;fs.writeFileSync(backup,current,{flag:'wx',mode:0o600});
  const temporary=file+'.cancel-release-'+now+'.tmp',fd=fs.openSync(temporary,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temporary,file);const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
  console.log(JSON.stringify({released:true,backup,resumedAt:now,exchangeWrites:0,settingsUnchanged:true}));
 }finally{ctl('start',service);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(/^[A-Z0-9_-]+$/.test(e.message)?e.message:'RECOVERY_FAILED');process.exitCode=1;});
