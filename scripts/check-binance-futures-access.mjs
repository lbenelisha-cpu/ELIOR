// Owner-run diagnostic: GET only. Never prints credentials or raw API errors.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHmac} from 'node:crypto';

try {
  const pid=execFileSync('systemctl',['show','levi-binance','-p','MainPID','--value'],{encoding:'utf8'}).trim();
  if(!/^[1-9]\d*$/.test(pid))throw Error('SERVICE_NOT_RUNNING');
  const entries=fs.readFileSync(`/proc/${pid}/environ`,'utf8').split('\0');
  const value=name=>entries.find(x=>x.startsWith(name+'='))?.slice(name.length+1).trim();
  const key=value('BINANCE_API_KEY'),secret=value('BINANCE_API_SECRET');
  if(!key||!secret)throw Error('SERVICE_CREDENTIALS_UNAVAILABLE');
  async function get(host,path,signed=false){
    let query='';
    if(signed){
      query=new URLSearchParams({timestamp:String(Math.round(Date.now()+offset)),recvWindow:'5000'}).toString();
      query+='&signature='+createHmac('sha256',secret).update(query).digest('hex');
    }
    const r=await fetch(host+path+(query?'?'+query:''),{
      method:'GET',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:signed?{'X-MBX-APIKEY':key}:{}
    });
    const data=await r.json();
    if(!r.ok||Number(data.code)<0)throw Error(`API_READ_FAILED HTTP=${r.status} code=${Number.isInteger(data.code)?data.code:'unknown'}`);
    return data;
  }
  const host='https://fapi.binance.com',start=Date.now();
  const clock=await get(host,'/fapi/v1/time');
  if(!Number.isFinite(clock.serverTime))throw Error('INVALID_SERVER_TIME');
  const offset=clock.serverTime-(start+Date.now())/2;
  const permissions=await get('https://api.binance.com','/sapi/v1/account/apiRestrictions',true);
  const account=await get(host,'/fapi/v2/account',true);
  const mode=await get(host,'/fapi/v1/positionSide/dual',true);
  const usdt=account.assets?.find(a=>a.asset==='USDT');
  console.log(JSON.stringify({
    readOnly:true,checkedAt:new Date().toISOString(),
    requestedPolicy:{market:'USD_M_USDT_PERPETUAL',direction:'SHORT',budgetUsdt:70,maxPositions:2,slotBudgetUsdt:35,leverage:1,marginType:'ISOLATED',autoAddMargin:false},
    executionEnabledByThisScript:false,
    enableFutures:permissions.enableFutures??null,ipRestrict:permissions.ipRestrict??null,
    canTrade:account.canTrade??null,multiAssetsMargin:account.multiAssetsMargin??null,
    hedgeMode:mode.dualSidePosition??null,
    walletUsdt:usdt?.walletBalance??null,availableUsdt:usdt?.availableBalance??null,
    positions:(account.positions||[]).filter(p=>Number(p.positionAmt)!==0).map(p=>({symbol:p.symbol,side:p.positionSide,quantity:p.positionAmt,isolated:p.isolated,leverage:p.leverage})),
    openOrderInitialMargin:account.totalOpenOrderInitialMargin??null,
    note:'Read access only; does not prove order submission, native protection, or bot readiness. Requested policy has NOT been applied.'
  },null,2));
} catch(error) {
  // Do not expose URLs, signatures, headers, service environment, or raw bodies.
  const message=String(error?.message||'');
  console.error(/^(SERVICE_NOT_RUNNING|SERVICE_CREDENTIALS_UNAVAILABLE|INVALID_SERVER_TIME|API_READ_FAILED HTTP=\d+ code=-?\d+)$/.test(message)?message:'READ_CHECK_FAILED: verify service access, network and API permissions.');
  process.exitCode=1;
}
