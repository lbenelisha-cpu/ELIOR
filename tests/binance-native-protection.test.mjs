import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {BinanceNativeProtection,nativeProtectionPlan} from '../lib/binance-native-protection.mjs';
import {applyTrailingExitPolicy} from '../lib/trailing-profit-exit.mjs';
import {binancePositionExit} from '../lib/binance-position-exit.mjs';
const symbol='ABCUSDT',info={symbol,status:'TRADING',ocoAllowed:true,orderTypes:['TAKE_PROFIT','STOP_LOSS'],filters:[{filterType:'LOT_SIZE',stepSize:'.01',minQty:'.01',maxQty:'100000'},{filterType:'PRICE_FILTER',tickSize:'.01',minPrice:'.01',maxPrice:'100000'},{filterType:'NOTIONAL',minNotional:'5'}]};
function rig(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'levi-native-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let p=applyTrailingExitPolicy({strategyId:'WYCKOFF_5M_V1',entryAt:'2026-10-24T10:00:00Z',entryPrice:100,peakPrice:100,qty:2}),last,posts=0,deletes=0,cancelUnknown=false,createUnknown=false,fillOnCancel=false;
 const children=new Map(),fills=new Map(),calls=[];
 const api={position:()=>p,persistFloor:async()=>{},info:async()=>info,free:async()=>p?.qty||0,
 post:async(url,params)=>{assert.equal(url,'/api/v3/orderList/oco');posts++;last=params;calls.push(['POST',params]);
  for(const id of [params.aboveClientOrderId,params.belowClientOrderId])children.set(id,{symbol,side:'SELL',clientOrderId:id,orderId:id,status:'NEW',executedQty:'0',cummulativeQuoteQty:'0'});
  if(createUnknown)throw Error('network timeout');return {};
 },
 get:async(url,params)=>{calls.push(['GET',params]);if(url==='/api/v3/orderList')return {symbol,listClientOrderId:params.origClientOrderId};const o=children.get(params.origClientOrderId);if(!o)throw Error('unknown identity');return {...o};},
 del:async(url,params)=>{deletes++;calls.push(['DELETE',params]);assert.equal(params.listClientOrderId,last.listClientOrderId);
  if(cancelUnknown)throw Error('network timeout');for(const [id,o]of children){if(o.status==='NEW'||o.status==='PARTIALLY_FILLED')o.status='CANCELED';}
  if(fillOnCancel){const o=children.get(last.belowClientOrderId);Object.assign(o,{status:'FILLED',executedQty:'2',cummulativeQuoteQty:'198',updateTime:Date.now()});}
  return {};
 },onFill:async(o,intent)=>{if(!fills.has(o.orderId)){fills.set(o.orderId,{...o,intent});p.qty-=Number(o.executedQty);if(p.qty<=0)p=null;}}};
 const file=path.join(dir,'protect.json'),store=new BinanceNativeProtection(file,api);
 return {store,api,file,children,fills,calls,get p(){return p},get last(){return last},get posts(){return posts},get deletes(){return deletes},loseCreate(){createUnknown=true},loseCancel(){cancelUnknown=true},fillCancel(){fillOnCancel=true},clearPosition(){p=null}};
}
test('native OCO uses actual fill, market triggers, +50% target, -1% stop and rounded net quantity',()=>{
 const p=applyTrailingExitPolicy({entryPrice:100,qty:1.999,peakPrice:100});const plan=nativeProtectionPlan(symbol,p,100,info,1.999);
 assert.equal(plan.quantity,'1.99');assert.equal(plan.stop,99);assert.equal(plan.target,150);assert.equal(plan.params.aboveType,'TAKE_PROFIT');assert.equal(plan.params.belowType,'STOP_LOSS');assert.equal(plan.params.abovePrice,undefined);
 assert.throws(()=>nativeProtectionPlan(symbol,p,100,{...info,ocoAllowed:false},2),/NOT_SUPPORTED/);
 assert.throws(()=>nativeProtectionPlan(symbol,p,100,info,.001),/LOCKED_ELSEWHERE/);
});
test('create persisted first; restart queries same IDs without a second create on unknown outcome',async t=>{
 const r=rig(t);r.loseCreate();await assert.rejects(r.store.sync(symbol,r.p,100),/timeout/);assert.equal(r.posts,1);assert.equal(JSON.parse(fs.readFileSync(r.file))[symbol].phase,'CREATING');
 const restored=new BinanceNativeProtection(r.file,r.api);await restored.sync(symbol,r.p,100);assert.equal(r.posts,1);assert.equal(restored.rows[symbol].phase,'ACTIVE');
});
test('unresolved create cannot be re-posted, sold over, or silently cleared',async t=>{
 const r=rig(t);r.loseCreate();await assert.rejects(r.store.sync(symbol,r.p,100));r.api.get=async()=>{throw Error('not found yet')};
 await assert.rejects(r.store.sync(symbol,r.p,100));await assert.rejects(r.store.release(symbol));assert.equal(r.posts,1);assert.equal(r.deletes,0);assert.equal(r.store.uncertain(),true);
});
test('trailing replacement cancels only owned list and never keeps old and new list live',async t=>{
 const r=rig(t);await r.store.sync(symbol,r.p,100);const old=r.last.listClientOrderId;r.store.rows[symbol].updatedAt=0;binancePositionExit(r.p,110);
 await r.store.sync(symbol,r.p,110);assert.equal(r.deletes,1);assert.equal(r.posts,2);assert.notEqual(r.last.listClientOrderId,old);assert.equal(r.last.belowStopPrice,'109');assert.equal(r.last.aboveStopPrice,'150');
 const writeMethods=r.calls.filter(c=>c[0]!=='GET').map(c=>c[0]);assert.deepEqual(writeMethods,['POST','DELETE','POST']);
});
test('cancel uncertainty blocks replacement and manual release until final confirmation',async t=>{
 const r=rig(t);await r.store.sync(symbol,r.p,100);r.loseCancel();await assert.rejects(r.store.release(symbol),/timeout/);assert.equal(r.store.rows[symbol].phase,'CANCELING');
 await assert.rejects(r.store.release(symbol),/timeout/);assert.equal(r.posts,1);assert.equal(r.deletes,2);
});
test('native sell fill during cancellation is recorded, prevents replacement and closes ownership',async t=>{
 const r=rig(t);await r.store.sync(symbol,r.p,100);r.store.rows[symbol].updatedAt=0;binancePositionExit(r.p,110);r.fillCancel();await r.store.sync(symbol,r.p,110);
 assert.equal(r.p,null);assert.equal(r.posts,1);assert.equal(r.fills.size,1);assert.equal([...r.fills.values()][0].intent.reason,'BROKER_STOP_LOSS');assert.equal(r.store.rows[symbol],undefined);
});
test('partial fills are finalized on cancellation and reconciled cumulatively once',async t=>{
 const r=rig(t);await r.store.sync(symbol,r.p,100);const o=r.children.get(r.last.belowClientOrderId);Object.assign(o,{status:'PARTIALLY_FILLED',executedQty:'.5',cummulativeQuoteQty:'49.5'});
 await r.store.reconcile(symbol);assert.equal(r.fills.size,0);await r.store.release(symbol);assert.equal(r.fills.size,1);assert.equal(r.p.qty,1.5);assert.equal(r.store.rows[symbol],undefined);
});
test('broker fill journal failure retains native identity for retry, never drops reconciliation',async t=>{
 const r=rig(t);await r.store.sync(symbol,r.p,100);r.children.get(r.last.aboveClientOrderId).status='CANCELED';Object.assign(r.children.get(r.last.belowClientOrderId),{status:'FILLED',executedQty:'2',cummulativeQuoteQty:'198'});
 const onFill=r.api.onFill;r.api.onFill=async()=>{throw Error('disk failure')};await assert.rejects(r.store.reconcile(symbol),/disk/);assert.ok(r.store.rows[symbol]);r.api.onFill=onFill;await r.store.reconcile(symbol);assert.equal(r.p,null);assert.equal(r.fills.size,1);
});
test('external holdings are never adopted and unknown orders are never cancelled',async t=>{
 const r=rig(t);r.clearPosition();await r.store.sync(symbol,null,100);await r.store.release('OTHERUSDT');assert.equal(r.posts,0);assert.equal(r.deletes,0);
});
test('activation at exact +4% does not cancel a valid old stop or place an immediately triggered stop',async t=>{
 const r=rig(t);await r.store.sync(symbol,r.p,100);r.store.rows[symbol].updatedAt=0;binancePositionExit(r.p,104);await r.store.sync(symbol,r.p,104);assert.equal(r.posts,1);assert.equal(r.deletes,0);
});
test('software fallback also exits at +50%, while +4% remains activation only',()=>{
 const p=applyTrailingExitPolicy({strategyId:'WYCKOFF_5M_V1',entryPrice:100,qty:1});assert.equal(binancePositionExit(p,104).sell,false);assert.equal(binancePositionExit(p,150).reason,'BROKER_TAKE_PROFIT_50_PERCENT');
});
test('failed persistence sends no order and stale quote after cancellation sends no replacement',async t=>{
 const a=rig(t);a.store.save=()=>{throw Error('disk')};await assert.rejects(a.store.sync(symbol,a.p,100),/disk/);assert.equal(a.posts,0);
 const r=rig(t);await r.store.sync(symbol,r.p,100);r.store.rows[symbol].updatedAt=0;binancePositionExit(r.p,110);r.api.price=()=>{throw Error('STALE_LIVE_PRICE')};await assert.rejects(r.store.sync(symbol,r.p,110),/STALE/);assert.equal(r.posts,1);assert.equal(r.deletes,1);
});
test('tiny token trigger prices are sent as decimal strings without scientific notation',()=>{
 const small={...info,filters:[...info.filters.filter(f=>f.filterType!=='PRICE_FILTER'),{filterType:'PRICE_FILTER',tickSize:'0.00000001',minPrice:'0.00000001',maxPrice:'1000'}]};
 const p=applyTrailingExitPolicy({entryPrice:0.0000001,qty:1e8});small.filters=small.filters.map(f=>f.filterType==='LOT_SIZE'?{...f,maxQty:'1000000000'}:f);
 const x=nativeProtectionPlan(symbol,p,.0000001,small,1e8);assert.equal(x.params.aboveStopPrice,'0.00000015');assert.equal(x.params.belowStopPrice,'0.0000001');
});
test('server manual market sale waits for bracket cancellation and rereads unlocked quantity',async()=>{
 const {default:vm}=await import('node:vm');const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8'),fn=source.slice(source.indexOf('async function placeLiveMarketSell('),source.indexOf('function persistLivePeak('));
 let released=false,sent;const c={nativeProtection:{release:async()=>{released=true;}},getApiRestrictions:async()=>({}),liveTradingGate:()=>({ready:true}),tradingPositions:()=>({[symbol]:{qty:2}}),getLiveAccountSnapshot:async()=>{assert.equal(released,true);return {balances:[{asset:'ABC',free:2,qty:2,usdtPrice:100}]};},symbolExchangeInfo:async()=>({...info,quoteAsset:'USDT'}),manualSellQuantity:()=> '2',liveOrders:{submit:async p=>{sent=p;return {status:'FILLED'};}},signedBinancePost(){},recordLiveFill(){}};
 vm.createContext(c);vm.runInContext(fn,c);await c.placeLiveMarketSell(symbol,'MANUAL_SELL',{sellAllBalance:true});assert.equal(sent.quantity,'2');
});
test('server never sends a second market sell when native reconciliation already closed the position',async()=>{
 const {default:vm}=await import('node:vm');const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8'),fn=source.slice(source.indexOf('async function placeLiveMarketSell('),source.indexOf('function persistLivePeak('));
 let owned=true,sent=0;const c={nativeProtection:{release:async()=>{owned=false;}},getApiRestrictions:async()=>({}),liveTradingGate:()=>({ready:true}),tradingPositions:()=>owned?{[symbol]:{qty:2}}:{},getLiveAccountSnapshot:async()=>{throw Error('must not attempt wallet sale');},liveOrders:{submit:async()=>sent++}};
 vm.createContext(c);vm.runInContext(fn,c);assert.equal((await c.placeLiveMarketSell(symbol,'MANUAL_SELL',{sellAllBalance:true})).status,'CLOSED_AT_BROKER');assert.equal(sent,0);
});
test('changing configured TP replaces an active bracket even when stop and quantity are unchanged',async t=>{
 const r=rig(t);await r.store.sync(symbol,r.p,100);r.store.rows[symbol].updatedAt=0;applyTrailingExitPolicy(r.p,{takeProfitPct:20,stopLossPct:1,profitActivationPct:4,trailingGapPp:1});await r.store.sync(symbol,r.p,100);assert.equal(r.posts,2);assert.equal(r.deletes,1);assert.equal(r.last.aboveStopPrice,'120');
});
