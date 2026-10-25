import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {BinanceNativeProtection} from '../lib/binance-native-protection.mjs';
import {applyTrailingExitPolicy} from '../lib/trailing-profit-exit.mjs';
import {protectionState} from '../lib/binance-dashboard-math.mjs';
import {protectionPrice} from '../lib/binance-protection-price.mjs';
const symbol='EWYBUSDT',info={symbol,status:'TRADING',ocoAllowed:true,orderTypes:['TAKE_PROFIT','STOP_LOSS'],filters:[{filterType:'LOT_SIZE',stepSize:'.001',minQty:'.001',maxQty:'10000'},{filterType:'PRICE_FILTER',tickSize:'.01',minPrice:'.01',maxPrice:'1000000'},{filterType:'NOTIONAL',minNotional:'5'},{filterType:'PERCENT_PRICE_BY_SIDE',askMultiplierUp:'1.2',askMultiplierDown:'.9',avgPriceMins:5}]};
function rig(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'levi-stop-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'native.json');
 let p=applyTrailingExitPolicy({entryPrice:152.34,qty:.187812,peakPrice:152.34,entryAt:'2026-10-25T21:41:11.732Z',strategyId:'WYCKOFF_5M_V1'}),price=152.05,unknownOco=false,unknownStop=false,unknownCancel=false,rejectStop=false,fillCancel=false;
 const orders=new Map(),fills=new Map(),writes=[];let store;
 const api={position:()=>p,price:()=>price,info:async()=>info,free:async()=>p?.qty||0,persistFloor:async()=>{},
  post:async(url,params)=>{
   const persisted=JSON.parse(fs.readFileSync(file))[symbol];assert.equal(persisted.phase,'CREATING');assert.deepEqual(persisted.params,params);writes.push({url,params:{...params}});
   if(url.endsWith('/oco')){if(unknownOco)throw Object.assign(Error('Timeout'),{status:504});throw Object.assign(Error('Filter failure: PERCENT_PRICE_BY_SIDE'),{code:-1013,status:400});}
   assert.equal(url,'/api/v3/order');assert.equal(params.type,'STOP_LOSS');assert.ok(Number(params.stopPrice)>0);
   if(rejectStop)throw Object.assign(Error('Filter failure: PERCENT_PRICE_BY_SIDE'),{status:400,code:-1013});
   orders.set(params.newClientOrderId,{symbol,side:'SELL',type:'STOP_LOSS',clientOrderId:params.newClientOrderId,orderId:params.newClientOrderId,status:'NEW',origQty:params.quantity,executedQty:'0',stopPrice:params.stopPrice});
   if(unknownStop)throw Error('Timeout');return {};
  },
  get:async(url,q)=>{const order=orders.get(q.origClientOrderId);if(!order)throw Error('Not found');return {...order};},
  del:async(url,q)=>{writes.push({url,method:'DELETE',params:q});assert.equal(url,'/api/v3/order');const o=orders.get(q.origClientOrderId);assert.ok(o);if(unknownCancel)throw Error('Timeout');o.status=fillCancel?'FILLED':'CANCELED';if(fillCancel)o.executedQty=o.origQty;return {};},
  onFill:async(o)=>{if(!fills.has(o.orderId)){fills.set(o.orderId,o);p.qty-=Number(o.executedQty);if(p.qty<.001)p=null;}}
 };
 store=new BinanceNativeProtection(file,api);
 return {store,api,file,writes,orders,fills,get p(){return p;},get price(){return price;},set price(v){price=v;},set unknownOco(v){unknownOco=v},set unknownStop(v){unknownStop=v},set unknownCancel(v){unknownCancel=v},set rejectStop(v){rejectStop=v},set fillCancel(v){fillCancel=v}};
}
test('confirmed OCO price-band rejection installs an independently verified stop without lowering TP',async t=>{
 const r=rig(t);await r.store.sync(symbol,r.p,r.price);const row=r.store.rows[symbol];assert.equal(r.writes.length,2);assert.equal(row.mode,'STOP_ONLY');assert.equal(row.phase,'ACTIVE');assert.equal(row.stop,150.82);assert.equal(row.target,228.51);assert.equal(row.params.quantity,'.187'.replace(/^\./,'0.'));assert.equal(row.params.aboveStopPrice,undefined);assert.ok(row.verifiedAt>0);assert.equal(r.p.takeProfitPct,50);
});
test('a rejected legacy OCO record recovers after restart without retrying its impossible target',async t=>{
 const r=rig(t);r.store.rows[symbol]={phase:'REJECTED',entryAt:r.p.entryAt,error:'Filter failure: PERCENT_PRICE_BY_SIDE',updatedAt:Date.now(),params:{quantity:'.187'}};r.store.save();
 const recovered=new BinanceNativeProtection(r.file,r.api);await recovered.sync(symbol,r.p,r.price);assert.equal(r.writes.length,1);assert.equal(recovered.rows[symbol].mode,'STOP_ONLY');assert.equal(recovered.rows[symbol].phase,'ACTIVE');
});
test('unknown OCO outcome never permits a standalone stop or second submission',async t=>{
 const r=rig(t);r.unknownOco=true;await assert.rejects(r.store.sync(symbol,r.p,r.price),/Timeout/);await assert.rejects(r.store.sync(symbol,r.p,r.price),/Not found/);assert.equal(r.writes.length,1);assert.equal(r.store.uncertain(),true);
});
test('unknown standalone stop is recovered by its original identity on restart without duplicate',async t=>{
 const r=rig(t);r.unknownStop=true;await assert.rejects(r.store.sync(symbol,r.p,r.price),/Timeout/);const id=r.store.rows[symbol].params.newClientOrderId;
 const restored=new BinanceNativeProtection(r.file,r.api);await restored.sync(symbol,r.p,r.price);assert.equal(r.writes.length,2);assert.equal(restored.rows[symbol].params.newClientOrderId,id);assert.equal(restored.rows[symbol].phase,'ACTIVE');
});
test('standalone cancellation uncertainty keeps its identity and blocks replacements',async t=>{
 const r=rig(t);await r.store.sync(symbol,r.p,r.price);r.unknownCancel=true;await assert.rejects(r.store.release(symbol),/Timeout/);const id=r.store.rows[symbol].params.newClientOrderId;
 await assert.rejects(r.store.sync(symbol,r.p,r.price),/Timeout/);assert.equal(r.writes.filter(x=>x.method!=='DELETE').length,2);assert.equal(r.store.rows[symbol].params.newClientOrderId,id);assert.equal(r.store.uncertain(),true);
});
test('standalone fill and fill during cancellation are journaled before removing ownership',async t=>{
 for(const cancel of [false,true]){const r=rig(t);await r.store.sync(symbol,r.p,r.price);const order=[...r.orders.values()][0];
  if(cancel){r.fillCancel=true;await r.store.release(symbol);}else{order.status='FILLED';order.executedQty=order.origQty;await r.store.reconcile(symbol);}
  assert.equal(r.fills.size,1);assert.equal(r.store.rows[symbol],undefined);assert.equal(r.p,null);await r.store.sync(symbol,null,r.price);assert.equal(r.writes.filter(x=>x.method!=='DELETE').length,2);
 }
});
test('partial standalone fills reserve ownership until final confirmation and remain idempotent',async t=>{
 const r=rig(t);await r.store.sync(symbol,r.p,r.price);const order=[...r.orders.values()][0];order.status='PARTIALLY_FILLED';order.executedQty='.1';await r.store.reconcile(symbol);assert.equal(r.fills.size,0);assert.equal(r.store.rows[symbol].hasUnsettledFill,true);await r.store.release(symbol);assert.equal(r.fills.size,1);assert.ok(Math.abs(r.p.qty-.087812)<1e-12);
});
test('failed fill persistence retains the stop identity for reconciliation retry',async t=>{
 const r=rig(t);await r.store.sync(symbol,r.p,r.price);const order=[...r.orders.values()][0];order.status='FILLED';order.executedQty=order.origQty;const write=r.api.onFill;r.api.onFill=async()=>{throw Error('disk')};await assert.rejects(r.store.reconcile(symbol),/disk/);assert.ok(r.store.rows[symbol]);r.api.onFill=write;await r.store.reconcile(symbol);assert.equal(r.fills.size,1);
});
test('changing software target alone never cancels a working exchange stop',async t=>{
 const r=rig(t);await r.store.sync(symbol,r.p,r.price);r.store.rows[symbol].updatedAt=0;r.p.takeProfitPct=40;await r.store.sync(symbol,r.p,r.price);assert.equal(r.writes.length,2);assert.equal(r.store.rows[symbol].phase,'ACTIVE');
});
test('mismatched broker stop fields never receive ACTIVE verification',async t=>{
 const r=rig(t);r.unknownStop=true;await assert.rejects(r.store.sync(symbol,r.p,r.price));[...r.orders.values()][0].stopPrice='140';await assert.rejects(r.store.reconcile(symbol),/MISMATCH/);assert.equal(r.store.rows[symbol].phase,'CREATING');
});
test('a rejected standalone stop remains visibly unprotected, with no recursive retry',async t=>{
 const r=rig(t);r.rejectStop=true;await assert.rejects(r.store.sync(symbol,r.p,r.price),/PERCENT_PRICE/);assert.equal(r.writes.length,2);assert.equal(r.store.rows[symbol].phase,'REJECTED');await r.store.sync(symbol,r.p,r.price);assert.equal(r.writes.length,2);
});
test('dashboard explicitly distinguishes a native stop from its software profit target',()=>{
 const h={ready:true,managedPositions:1,missingProtection:[],softwareTargets:[symbol],reconciliation:{checkedAt:new Date().toISOString()}};const view=protectionState(h);assert.match(view.text,/הסטופ אומת/);assert.match(view.text,/יעד הרווח במעקב השרת/);
});

test('trailing a standalone stop cancels its exact order and retains standalone mode',async t=>{
 const r=rig(t);await r.store.sync(symbol,r.p,r.price);const old=r.store.rows[symbol].params.newClientOrderId;r.store.rows[symbol].updatedAt=0;r.p.effectiveStopPrice=155;r.price=160;
 await r.store.sync(symbol,r.p,r.price);assert.equal(r.writes.length,4);assert.equal(r.writes[2].method,'DELETE');assert.equal(r.writes[2].params.origClientOrderId,old);assert.equal(r.orders.get(old).status,'CANCELED');assert.equal(r.writes[3].params.stopPrice,'155');assert.equal(r.store.rows[symbol].mode,'STOP_ONLY');assert.equal(r.store.rows[symbol].phase,'ACTIVE');
});

test('a missing trade stream recovers the rejected stop using a fresh REST quote',async t=>{
 const r=rig(t);r.store.rows[symbol]={phase:'REJECTED',entryAt:r.p.entryAt,error:'Filter failure: PERCENT_PRICE_BY_SIDE',updatedAt:Date.now(),params:{quantity:'.187'}};
 let reads=0;r.api.price=()=>protectionPrice(symbol,{status:'connected',lastPrice:null},async()=>{reads++;return {symbol,lastPrice:'152.61',bidPrice:'152.31',askPrice:'152.37',closeTime:Date.now()};});
 await r.store.sync(symbol,r.p,null);assert.equal(r.writes.length,1);assert.equal(r.store.rows[symbol].phase,'ACTIVE');assert.equal(r.store.rows[symbol].stop,150.82);assert.equal(reads,2);
 r.api.price=()=>{throw Error('offline');};await r.store.sync(symbol,r.p,null);assert.equal(r.writes.length,1);assert.equal(r.store.rows[symbol].phase,'ACTIVE');
});
test('failed recovery quote leaves rejected protection visible and submits nothing',async t=>{
 const r=rig(t);r.store.rows[symbol]={phase:'REJECTED',entryAt:r.p.entryAt,error:'Filter failure: PERCENT_PRICE_BY_SIDE',updatedAt:Date.now(),params:{quantity:'.187'}};
 r.api.price=async()=>{throw Error('NATIVE_PROTECTION_FRESH_QUOTE_REQUIRED');};await assert.rejects(r.store.sync(symbol,r.p,null),/FRESH_QUOTE/);assert.equal(r.writes.length,0);assert.equal(r.store.rows[symbol].phase,'REJECTED');
});
