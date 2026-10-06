import {createHmac} from 'node:crypto';
const ORIGIN='https://demo-api.binance.com';
export function valueBalances(balances,prices){
  if(!Array.isArray(balances)||!Array.isArray(prices))throw Error('Invalid Demo account response');
  for(const b of balances){
    if(typeof b.asset!=='string'||!b.asset||b.free==null||b.locked==null||
       !Number.isFinite(Number(b.free))||!Number.isFinite(Number(b.locked))||
       Number(b.free)<0||Number(b.locked)<0)throw Error('Invalid Demo asset balance');
  }
  const rates=new Map(prices.map(p=>[p.symbol,Number(p.price)]));
  const rate=(asset)=>{
    if(asset==='USDT')return 1;
    const direct=rates.get(asset+'USDT'), inverse=rates.get('USDT'+asset);
    if(Number.isFinite(direct)&&direct>0)return direct;
    if(Number.isFinite(inverse)&&inverse>0)return 1/inverse;
    for(const bridge of ['BTC','ETH','USDC','BNB']){
      const leg=rates.get(asset+bridge), tail=rates.get(bridge+'USDT');
      if(Number.isFinite(leg)&&Number.isFinite(tail)&&leg>0&&tail>0&&Number.isFinite(leg*tail))return leg*tail;
    }
    return null;
  };
  const rows=balances.map(b=>({asset:b.asset,free:Number(b.free),locked:Number(b.locked)})).filter(b=>b.free+b.locked>0).map(b=>{
    const qty=b.free+b.locked,price=rate(b.asset);
    return {...b,qty,priceUsdt:price,valueUsdt:price===null?null:qty*price};
  });
  return {balances:rows,totalValueUsdt:rows.reduce((n,b)=>n+(b.valueUsdt??0),0),unpricedAssets:rows.filter(b=>b.valueUsdt===null).map(b=>b.asset)};
}
export async function getDemoAccount({key,secret,fetcher=fetch}){
  if(!key||!secret)throw Error('יש להגדיר מפתחות API של חשבון הדמו בשרת');
  const get=async(path)=>{
    const response=await fetcher(ORIGIN+path,{headers:{'X-MBX-APIKEY':key},signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    if(!response.ok)throw Error(data.msg||'Demo API error '+response.status);
    return data;
  };
  const time=await get('/api/v3/time');
  const query=new URLSearchParams({timestamp:String(time.serverTime),recvWindow:'5000',omitZeroBalances:'true'});
  const signature=createHmac('sha256',secret).update(query.toString()).digest('hex');
  const [account,prices]=await Promise.all([get('/api/v3/account?'+query+'&signature='+signature),get('/api/v3/ticker/price')]);
  return {source:'BINANCE_DEMO_SPOT',...valueBalances(account.balances,prices),updatedAt:new Date().toISOString()};
}
