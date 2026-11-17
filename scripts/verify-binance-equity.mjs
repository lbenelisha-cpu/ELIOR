// Use only the running service's local, authenticated GET endpoints.
import fs from 'node:fs';
import path from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {execFileSync} from 'node:child_process';

const args=process.argv.slice(2);
if(args.length>1||args.some(arg=>!['--verify-series','--first-futures-sample'].includes(arg)))throw Error('Unknown verification option');
const verifySeries=args.includes('--verify-series');
const pid=execFileSync('systemctl',['show','levi-binance','-p','MainPID','--value'],{encoding:'utf8'}).trim();
if(!/^[1-9]\d*$/.test(pid))throw Error('Binance service is not running');
const environment=fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0');
const value=name=>environment.find(item=>item.startsWith(name+'='))?.slice(name.length+1);
const token=value('BINANCE_CONTROL_TOKEN');
const port=Number(value('PORT')||8080);
if(!token)throw Error('Existing local authorization unavailable');
if(!Number.isInteger(port)||port<=0||port>65535)throw Error('Invalid service port');
const url='http://127.0.0.1:'+port+'/api/binance-equity-history';
const get=(suffix,authorized,timeout=5000)=>fetch(url+suffix,{
  headers:authorized?{Authorization:'Bearer '+token}:{},redirect:'error',signal:AbortSignal.timeout(timeout)
});

function savedStatus(data,journal,now){
  if(data.storageError)return 'Futures recorder reports a storage error. Persistence could not be verified.';
  const point=data.points.at(-1);
  if(data.sampleError)return 'Futures account sampling is unavailable. The recorder will retry.';
  if(!point||!Number.isFinite(point.valueUsdt)||!Number.isSafeInteger(point.at)||point.at<now-150000||point.at>now+5000)
    return 'Pending: no recent Futures account measurement yet. The recorder will retry.';
  try{
    const file=JSON.parse(fs.readFileSync(journal,'utf8'));
    if(file.market==='FUTURES'&&file.points?.some(p=>p.at===point.at&&p.valueUsdt===point.valueUsdt))return null;
  }catch{/* The reading may have arrived immediately before the atomic rename. */}
  return 'A recent Futures measurement exists but its journal write could not be verified.';
}

async function reportFuturesSample(){
  const journal=path.resolve('/proc/'+pid+'/cwd',(value('BINANCE_EQUITY_HISTORY_FILE')||'/var/data/binance-equity-history.json')+'.futures');
  const deadline=Date.now()+15000;
  let status='Futures sample verification unavailable.';
  while(Date.now()<deadline){
    try{
      const res=await get('?market=FUTURES',true,Math.max(1,Math.min(deadline-Date.now(),2500)));
      if(!res.ok)throw Error('Futures history unavailable');
      const data=await res.json();
      if(data.market!=='FUTURES'||data.source!=='BINANCE_FUTURES_USDT_ACCOUNT_SNAPSHOTS'||!Array.isArray(data.points))
        throw Error('Futures history unavailable');
      status=savedStatus(data,journal,Date.now());
      if(status===null){
        console.log('Confirmed: a recent Futures equity sample is saved in the server journal.');
        return;
      }
    }catch{status='Futures sample verification unavailable. Check the local history endpoint.';}
    await wait(Math.max(0,Math.min(2000,deadline-Date.now())));
  }
  console.log(status);
}

if(args.includes('--first-futures-sample')){
  await reportFuturesSample();
}else if(verifySeries){
  for(const [suffix,market,source] of [
    ['','SPOT','BINANCE_SPOT_ACCOUNT_SNAPSHOTS'],
    ['?market=FUTURES','FUTURES','BINANCE_FUTURES_USDT_ACCOUNT_SNAPSHOTS']
  ]){
    const denied=await get(suffix,false);
    if(denied.status!==401)throw Error(market+' endpoint failed private access check');
    const response=await get(suffix,true);
    if(response.status!==200)throw Error(market+' equity endpoint returned '+response.status);
    const d=await response.json();
    if(d.ok!==true||d.market!==market||d.source!==source||d.currency!=='USDT'||!Array.isArray(d.points)||!d.summary)
      throw Error('Unexpected '+market+' equity history');
  }
  console.log('Verified private Spot and Futures equity endpoints and account sources.');
}else{
  const response=await get('',true);
  if(!response.ok)throw Error('Equity read failed');
  const data=await response.json();
  console.log(JSON.stringify({source:data.source,day:data.day,timeZone:data.timeZone,summary:data.summary,stale:data.stale,storageError:data.storageError,unpricedAssets:data.unpricedAssets},null,2));
}
