// Display-only, minute observations of the whole Spot wallet. No trading access.
import fs from 'node:fs';
import path from 'node:path';
export const EQUITY_TIMEZONE='Asia/Jerusalem';
const dayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:EQUITY_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'});
export const equityDay=at=>dayFormatter.format(new Date(at));
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const validPoint=p=>p&&Number.isSafeInteger(p.at)&&p.at>0&&(p.valueUsdt===null||finite(p.valueUsdt))&&Array.isArray(p.unpricedAssets)&&p.unpricedAssets.every(a=>typeof a==='string');
export class EquityHistory {
 constructor({file,now=Date.now,retentionDays=30}={}){
  this.file=file;this.now=now;this.retentionMs=retentionDays*86400000;this.points=[];this.storageError=false;this.loadError=false;this.lastError=null;
  if(file)try{
   const data=JSON.parse(fs.readFileSync(file,'utf8'));
   if(data.version!==1||!Array.isArray(data.points)||!data.points.every(validPoint))throw Error('INVALID_EQUITY_FILE');
   this.points=data.points.filter(p=>p.at>=now()-this.retentionMs&&p.at<=now()+5000).sort((a,b)=>a.at-b.at).slice(-45000);
  }catch(error){if(error.code!=='ENOENT'){this.loadError=true;this.storageError=true;}}
 }
 record(account){
  const now=this.now(),at=Date.parse(account?.updatedAt);
  if(account?.connected!==true||!Array.isArray(account.balances)||!Number.isFinite(at)||at>now+5000||now-at>120000)throw Error('EQUITY_ACCOUNT_NOT_FRESH');
  const unpricedAssets=[];let valueUsdt=0;
  for(const b of account.balances){
   if(typeof b.asset!=='string'||!finite(b.qty))throw Error('EQUITY_BALANCE_INVALID');
   if(b.qty===0)continue;
   if(!finite(b.usdtPrice)||b.usdtPrice===0){unpricedAssets.push(b.asset);continue;}
   valueUsdt+=b.qty*b.usdtPrice;
  }
  if(!Number.isFinite(valueUsdt))throw Error('EQUITY_VALUE_INVALID');
  const point={at,valueUsdt:unpricedAssets.length?null:valueUsdt,unpricedAssets};
  const last=this.points.at(-1);
  // Never replace history with an older observation or oversample a minute.
  if(last&&Math.floor(at/60000)<=Math.floor(last.at/60000))return false;
  const next=[...this.points.filter(p=>p.at>=now-this.retentionMs),point].slice(-45000);
  this.points=next;this.lastError=null;
  if(this.file&&!this.loadError)try{
   fs.mkdirSync(path.dirname(this.file),{recursive:true});
   fs.writeFileSync(this.file+'.tmp',JSON.stringify({version:1,points:next}),{mode:0o600});
   fs.renameSync(this.file+'.tmp',this.file);this.storageError=false;
  }catch{this.storageError=true;}
  return true;
 }
 failed(){this.lastError='SAMPLE_FAILED';}
 today(){
  const now=this.now(),day=equityDay(now),points=this.points.filter(p=>p.at>=now-26*3600000&&equityDay(p.at)===day),valid=points.filter(p=>p.valueUsdt!==null),first=valid[0],latest=valid.at(-1),last=points.at(-1);
  const change=first&&latest?latest.valueUsdt-first.valueUsdt:null;
  return {ok:true,source:'BINANCE_SPOT_ACCOUNT_SNAPSHOTS',currency:'USDT',timeZone:EQUITY_TIMEZONE,day,sampleIntervalMs:60000,asOf:new Date(now).toISOString(),points,
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
