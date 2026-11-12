import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

export function patch(source){
 const old="strategyStopOnly?{...plan.params,newClientOrderId:identity('lv-s-')}";
 const fixed="strategyStopOnly?{symbol,side:'SELL',type:'STOP_LOSS',quantity:plan.quantity,stopPrice:plan.params.stopPrice??plan.params.belowStopPrice,newClientOrderId:identity('lv-s-'),newOrderRespType:'FULL'}";
 if(source.split(old).length!==2)throw Error('Unrecognized native stop payload; no changes');
 return source.replace(old,fixed);
}
export async function verify(source){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'levi-stop-check-'));
 try{
  const moduleFile=path.join(dir,'native.mjs');fs.writeFileSync(moduleFile,source);
  const {BinanceNativeProtection}=await import(pathToFileURL(moduleFile));
  for(const strategyId of ['MANUAL','POC_AUTO_V1']){
   const symbol='AMDBUSDT',p={strategyId,entryAt:'2026-11-12T13:01:57.829Z',entryPrice:560.61,qty:.088,effectiveStopPrice:555.01,takeProfitPct:50};
   const info={symbol,status:'TRADING',ocoAllowed:true,orderTypes:['TAKE_PROFIT','STOP_LOSS'],filters:[{filterType:'LOT_SIZE',stepSize:'.001',minQty:'.001',maxQty:'10000'},{filterType:'PRICE_FILTER',tickSize:'.01',minPrice:'.01',maxPrice:'100000'},{filterType:'NOTIONAL',minNotional:'5'}]};
   let last,posts=0,unknown=false;
   const api={position:()=>p,info:async()=>info,free:async()=>p.qty,price:async()=>560.61,persistFloor:async()=>{},onFill:async()=>{throw Error('Unexpected fill')},del:async()=>{throw Error('Unexpected cancellation')},
    post:async(url,params)=>{posts++;assert.equal(url,'/api/v3/order');assert.deepEqual(Object.keys(params).sort(),['symbol','side','type','quantity','stopPrice','newClientOrderId','newOrderRespType'].sort());assert.equal(params.type,'STOP_LOSS');assert.equal(params.side,'SELL');assert.equal(params.stopPrice,'555.01');assert.equal(params.quantity,'0.088');last=params;if(unknown)throw Error('timeout');return {};},
    get:async(url,params)=>{assert.equal(url,'/api/v3/order');assert.equal(params.origClientOrderId,last.newClientOrderId);return {symbol,side:'SELL',type:'STOP_LOSS',clientOrderId:last.newClientOrderId,origQty:last.quantity,stopPrice:last.stopPrice,executedQty:'0',status:'NEW'};}};
   const store=new BinanceNativeProtection(path.join(dir,strategyId+'.json'),api);
   store.rows[symbol]={phase:'REJECTED',mode:'STOP_ONLY',entryAt:p.entryAt,updatedAt:0,errorCode:-1102,params:{symbol,side:'SELL',quantity:'.088'}};
   await store.sync(symbol,p,560.61);assert.equal(posts,1);assert.equal(store.rows[symbol].phase,'ACTIVE');assert.ok(store.rows[symbol].verifiedAt>0);
   await store.sync(symbol,p,560.61);assert.equal(posts,1);
   // Unknown submission outcomes retain the durable identity and recover by GET.
   store.rows[symbol]={phase:'REJECTED',mode:'STOP_ONLY',entryAt:p.entryAt,updatedAt:0,params:{symbol}};unknown=true;
   await assert.rejects(store.sync(symbol,p,560.61),/timeout/);assert.equal(store.rows[symbol].phase,'CREATING');const attempts=posts;
   const restored=new BinanceNativeProtection(store.file,api);await restored.sync(symbol,p,560.61);assert.equal(posts,attempts);assert.equal(restored.rows[symbol].phase,'ACTIVE');
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const root=path.resolve(process.argv[2]||'.'),file=path.join(root,'lib/binance-native-protection.mjs');
 const original=fs.readFileSync(file,'utf8'),fixed=patch(original);
 await verify(fixed);console.log('PASS: rejected manual/POC stops recover, payload validated, no duplicate on uncertain response');
 if(process.argv.includes('--check-only'))process.exit(0);
 const backup=file+'.before-stop-payload-'+Date.now();fs.copyFileSync(file,backup);
 execFileSync('systemctl',['stop','levi-binance']);
 try{
  assert.equal(fs.readFileSync(file,'utf8'),original,'Source changed during staging');
  fs.writeFileSync(file+'.stage',fixed,{mode:fs.statSync(file).mode});fs.renameSync(file+'.stage',file);
  execFileSync('node',['--check',file]);execFileSync('systemctl',['start','levi-binance']);
  execFileSync('systemctl',['is-active','--quiet','levi-binance']);
  console.log('Installed native STOP_LOSS payload fix. Backup: '+backup);
 }catch(error){fs.copyFileSync(backup,file);execFileSync('systemctl',['start','levi-binance']);throw error;}
}
