import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {EquityHistory,equityDay,createEquitySampler} from '../lib/binance-equity-history.mjs';
const start=Date.parse('2026-10-26T15:00:00Z');
const account=(at,price=2)=>({connected:true,updatedAt:new Date(at).toISOString(),totalValueUsdt:999,balances:[{asset:'USDT',qty:100,usdtPrice:1},{asset:'ENA',qty:20,usdtPrice:price}]});
test('whole Spot wallet value is observed, not unrealized P/L, and one point is kept per minute',()=>{let now=start;const h=new EquityHistory({now:()=>now});h.record(account(now));assert.equal(h.record(account(now+1000,3)),false);now+=60000;h.record(account(now,2.5));const r=h.today();assert.equal(r.summary.currentUsdt,150);assert.equal(r.summary.firstUsdt,140);assert.equal(r.summary.changeUsdt,10);assert.equal(r.summary.count,2);assert.equal(r.summary.lowUsdt,140);assert.equal(r.summary.highUsdt,150);assert.equal(r.stale,false);now+=151000;assert.equal(h.today().stale,true);});
test('missing prices create a gap rather than a fake loss; zero balance is a valid value',()=>{let now=start;const h=new EquityHistory({now:()=>now});h.record(account(now));now+=60000;h.record(account(now,0));let r=h.today();assert.equal(r.points[1].valueUsdt,null);assert.deepEqual(r.unpricedAssets,['ENA']);assert.equal(r.summary.changeUsdt,0);assert.equal(r.stale,true);now+=60000;h.record({connected:true,updatedAt:new Date(now).toISOString(),balances:[]});r=h.today();assert.equal(r.summary.currentUsdt,0);assert.equal(r.summary.changePct,-100);assert.equal(r.stale,false);});
test('today rolls over at Jerusalem midnight, including daylight saving dates',()=>{assert.equal(equityDay('2026-10-24T21:30:00Z'),'2026-10-25');assert.equal(equityDay('2026-10-26T21:59:59Z'),'2026-10-26');let now=Date.parse('2026-10-26T21:59:00Z');const h=new EquityHistory({now:()=>now});h.record(account(now));now+=60000;assert.equal(h.today().day,'2026-10-27');assert.equal(h.today().summary.currentUsdt,null);h.record(account(now,3));assert.equal(h.today().summary.changeUsdt,0);assert.equal(h.today().summary.count,1);});
test('persisted history survives restart, retention is bounded, corrupt original is preserved',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'equity-')),file=path.join(dir,'history.json');try{let now=start;const h=new EquityHistory({file,now:()=>now});h.record(account(now));const restored=new EquityHistory({file,now:()=>now});assert.equal(restored.today().summary.currentUsdt,140);assert.equal(fs.statSync(file).mode&0o777,0o600);now+=31*86400000;assert.equal(new EquityHistory({file,now:()=>now}).points.length,0);fs.writeFileSync(file,'broken original');const bad=new EquityHistory({file,now:()=>now});bad.record(account(now));assert.equal(bad.today().storageError,true);assert.equal(fs.readFileSync(file,'utf8'),'broken original');}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('invalid or stale observations never enter the chart and overlapping samples share one read',async()=>{let resolve,calls=0;const h=new EquityHistory({now:()=>start});assert.throws(()=>h.record(account(start-121000)));assert.throws(()=>h.record(account(start+10000)));assert.throws(()=>h.record({...account(start),balances:[{asset:'ENA',qty:NaN,usdtPrice:2}]}));const sample=createEquitySampler({history:h,readAccount:()=>{calls++;return new Promise(r=>resolve=r);}});const a=sample(),b=sample();await Promise.resolve();assert.equal(calls,1);resolve(account(start));await Promise.all([a,b]);assert.equal(h.points.length,1);await createEquitySampler({history:h,readAccount:()=>{throw Error('private upstream detail');}})();assert.equal(h.today().sampleError,true);assert.equal(h.today().stale,true);assert.equal(h.today().summary.currentUsdt,140);});

test('Futures samples use USDT margin equity, include unrealized losses and accept a confirmed zero',()=>{
 let now=start;
 const history=new EquityHistory({market:'FUTURES',now:()=>now});
 const record=account=>history.record({observedAt:now,account:{multiAssetsMargin:false,...account}});
 const usdt={asset:'USDT',walletBalance:'140',unrealizedProfit:'-28.5',availableBalance:'2'};
 assert.equal(history.today().summary.currentUsdt,null);
 record({assets:[{...usdt,marginBalance:'112'}]});
 assert.equal(history.today().summary.currentUsdt,112);
 now+=60000;record({assets:[usdt]});
 assert.equal(history.today().summary.currentUsdt,111.5);
 now+=60000;record({assets:[],totalMarginBalance:'0.00000000'});
 const result=history.today();assert.equal(result.market,'FUTURES');
 assert.equal(result.source,'BINANCE_FUTURES_USDT_ACCOUNT_SNAPSHOTS');
 assert.deepEqual(result.points.map(point=>point.valueUsdt),[112,111.5,0]);
 assert.equal(result.summary.changePct,-100);
});

test('incomplete, stale, multi-asset or failed Futures reads never fabricate equity',async()=>{
 let now=start;
 const history=new EquityHistory({market:'FUTURES',now:()=>now});
 const read=(account,observedAt=now)=>({account,observedAt});
 const sample=reply=>createEquitySampler({history,readAccount:()=>reply})();
 await sample(read({multiAssetsMargin:false,totalMarginBalance:'37'}));
 now+=60000;
 for(const bad of [
  read({multiAssetsMargin:true,totalMarginBalance:'900'}),
  read({multiAssetsMargin:false,totalMarginBalance:' ',assets:[{asset:'USDT',walletBalance:'17',unrealizedProfit:null}]}),
  read({multiAssetsMargin:false,assets:[{asset:'USDC',marginBalance:'80'}]}),
  read({multiAssetsMargin:false,totalMarginBalance:Infinity}),
  read({multiAssetsMargin:false,totalMarginBalance:0},now-121000),
  read({multiAssetsMargin:false,totalMarginBalance:0},now+6000)
 ]){
  assert.equal(await sample(bad),false);
  assert.equal(history.today().summary.currentUsdt,37);
  assert.equal(history.today().summary.count,1);
  assert.equal(history.today().sampleError,true);
 }
 now+=60000;await sample(read({multiAssetsMargin:false,totalMarginBalance:'35'}));
 assert.equal(history.today().stale,false);assert.equal(history.today().summary.count,2);
});

test('preexisting Spot journal never populates Futures; each market survives a restart independently',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'separate-wallets-'));
 try{
  const file=path.join(folder,'equity.json'),now=()=>start;
  const legacy={version:1,points:[{at:start,valueUsdt:80,unpricedAssets:[]}]};
  fs.writeFileSync(file,JSON.stringify(legacy));
  const spot=new EquityHistory({file,now});
  assert.equal(spot.today().summary.currentUsdt,80);
  const incorrect=new EquityHistory({file,market:'FUTURES',now});
  assert.equal(incorrect.today().summary.currentUsdt,null);
  assert.equal(incorrect.today().storageError,true);
  const futureFile=file+'.futures';
  const futures=new EquityHistory({file:futureFile,market:'FUTURES',now});
  futures.record({observedAt:start,account:{multiAssetsMargin:false,totalMarginBalance:'-1.25'}});
  assert.equal(new EquityHistory({file:futureFile,market:'FUTURES',now}).today().summary.currentUsdt,-1.25);
  assert.equal(fs.readFileSync(file,'utf8'),JSON.stringify(legacy));
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
