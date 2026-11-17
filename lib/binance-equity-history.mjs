// Independent, display-only USDT equity observations. No trading access.
import fs from 'node:fs';
import path from 'node:path';
export const EQUITY_TIMEZONE='Asia/Jerusalem';
const dayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:EQUITY_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'});
export const equityDay=at=>dayFormatter.format(new Date(at));
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const sources={SPOT:'BINANCE_SPOT_ACCOUNT_SNAPSHOTS',FUTURES:'BINANCE_FUTURES_USDT_ACCOUNT_SNAPSHOTS'};
export function equityHistoryMarket(params){
 const markets=params.getAll('market');
 if([...params.keys()].some(key=>key!=='market')||markets.length>1)return null;
 const market=markets[0]??'SPOT';
 return Object.hasOwn(sources,market)?market:null;
}
function futuresValue(account){
 if(account?.multiAssetsMargin!==false)throw Error('FUTURES_USDT_MARGIN_UNCONFIRMED');
 const usdt=account.assets?.find(asset=>asset?.asset==='USDT');
 const amount=value=>{
  if(typeof value==='number')return value;
  if(typeof value==='string'&&value.trim()!=='')return Number(value);
  return NaN;
 };
 // The per-asset balance is denominated in USDT. In single-asset mode Binance
 // also reports the USDT margin balance in the account total.
 for(const candidate of [usdt?.marginBalance,account.totalMarginBalance]){
  const balance=amount(candidate);
  if(Number.isFinite(balance))return balance;
 }
 const equity=amount(usdt?.walletBalance)+amount(usdt?.unrealizedProfit);
 if(!Number.isFinite(equity))throw Error('FUTURES_USDT_MARGIN_UNCONFIRMED');
 return equity;
}
const validPoint=(p,market)=>p&&Number.isSafeInteger(p.at)&&p.at>0&&(p.valueUsdt===null||(market==='FUTURES'?Number.isFinite(p.valueUsdt):finite(p.valueUsdt)))&&Array.isArray(p.unpricedAssets)&&p.unpricedAssets.every(a=>typeof a==='string');
export class EquityHistory {
 constructor({file,now=Date.now,retentionDays=30,market='SPOT'}={}){
  if(!Object.hasOwn(sources,market))throw Error('INVALID_EQUITY_MARKET');
  this.market=market;
  this.file=file;this.now=now;this.retentionMs=retentionDays*86400000;this.points=[];this.storageError=false;this.loadError=false;this.lastError=null;
  if(file)try{
   const data=JSON.parse(fs.readFileSync(file,'utf8'));
   if(data.version!==1||(data.market??'SPOT')!==market||!Array.isArray(data.points)||!data.points.every(point=>validPoint(point,market)))throw Error('INVALID_EQUITY_FILE');
   this.points=data.points.filter(p=>p.at>=now()-this.retentionMs&&p.at<=now()+5000).sort((a,b)=>a.at-b.at).slice(-45000);
  }catch(error){if(error.code!=='ENOENT'){this.loadError=true;this.storageError=true;}}
 }
 record(account){
  if(this.market==='FUTURES'){
   return this.#append({at:account?.observedAt,valueUsdt:futuresValue(account?.account),unpricedAssets:[]});
  }
  const at=Date.parse(account?.updatedAt);
  if(account?.connected!==true||!Array.isArray(account.balances))throw Error('EQUITY_ACCOUNT_NOT_FRESH');
  const unpricedAssets=[];let valueUsdt=0;
  for(const b of account.balances){
   if(typeof b.asset!=='string'||!finite(b.qty))throw Error('EQUITY_BALANCE_INVALID');
   if(b.qty===0)continue;
   if(!finite(b.usdtPrice)||b.usdtPrice===0){unpricedAssets.push(b.asset);continue;}
   valueUsdt+=b.qty*b.usdtPrice;
  }
  if(!Number.isFinite(valueUsdt))throw Error('EQUITY_VALUE_INVALID');
  return this.#append({at,valueUsdt:unpricedAssets.length?null:valueUsdt,unpricedAssets});
 }
 #append(point){
  const now=this.now(),at=point.at;
  if(!Number.isSafeInteger(at)||at<=0||at>now+5000||now-at>120000)throw Error('EQUITY_ACCOUNT_NOT_FRESH');
  const last=this.points.at(-1);
  // Never replace history with an older observation or oversample a minute.
  if(last&&Math.floor(at/60000)<=Math.floor(last.at/60000))return false;
  const next=[...this.points.filter(p=>p.at>=now-this.retentionMs),point].slice(-45000);
  this.points=next;this.lastError=null;
  if(this.file&&!this.loadError)try{
   fs.mkdirSync(path.dirname(this.file),{recursive:true});
   fs.writeFileSync(this.file+'.tmp',JSON.stringify({version:1,market:this.market,points:next}),{mode:0o600});
   fs.renameSync(this.file+'.tmp',this.file);this.storageError=false;
  }catch{this.storageError=true;}
  return true;
 }
 failed(){this.lastError='SAMPLE_FAILED';}
 today(){
  const now=this.now(),day=equityDay(now),points=this.points.filter(p=>p.at>=now-26*3600000&&equityDay(p.at)===day),valid=points.filter(p=>p.valueUsdt!==null),first=valid[0],latest=valid.at(-1),last=points.at(-1);
  const change=first&&latest?latest.valueUsdt-first.valueUsdt:null;
  return {ok:true,market:this.market,source:sources[this.market],currency:'USDT',timeZone:EQUITY_TIMEZONE,day,sampleIntervalMs:60000,asOf:new Date(now).toISOString(),points,
   summary:{currentUsdt:latest?.valueUsdt??null,firstUsdt:first?.valueUsdt??null,firstAt:first?.at??null,lastAt:latest?.at??null,changeUsdt:change,changePct:first?.valueUsdt>0?change/first.valueUsdt*100:null,
    lowUsdt:valid.length?Math.min(...valid.map(p=>p.valueUsdt)):null,highUsdt:valid.length?Math.max(...valid.map(p=>p.valueUsdt)):null,count:valid.length},
   stale:!latest||now-latest.at>150000||last?.valueUsdt===null||!!this.lastError,
   unpricedAssets:last?.unpricedAssets||[],storageError:this.storageError,sampleError:!!this.lastError};
 }
}

export function createEquitySampler({history,readAccount}){
 let pending=null;
 return ()=>{
  if(pending)return pending;
  pending=Promise.resolve().then(readAccount).then(account=>history.record(account)).catch(()=>{history.failed();return false;}).finally(()=>{pending=null;});
  return pending;
 };
}
