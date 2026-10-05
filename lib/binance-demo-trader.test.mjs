import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DemoTrader,allocation,floorQuantity} from './binance-demo-trader.mjs';
function setup({usdt=9000,usdc=0,timeout=false}={}){
 const dir=mkdtempSync(path.join(tmpdir(),'demo-test-'));const requests=[],orders=[];
 const balances={USDT:usdt,USDC:usdc,BTC:0,ETH:0,SOL:0};const prices={BTC:100,ETH:50,SOL:10,USDC:1};
 const fetcher=async(url,options={})=>{
  const u=new URL(url);assert.equal(u.origin,'https://demo-api.binance.com');requests.push({u,options});let d;
  const symbol=u.searchParams.get('symbol'),asset=symbol?.replace(/USDT$/,'');
  if(u.pathname==='/api/v3/time')d={serverTime:Date.now()};
  else if(u.pathname==='/api/v3/account')d={balances:Object.entries(balances).map(([asset,free])=>({asset,free:String(free),locked:'0'}))};
  else if(u.pathname==='/api/v3/ticker/price')d=Object.entries(prices).map(([asset,price])=>({symbol:asset+'USDT',price:String(price)}));
  else if(u.pathname==='/api/v3/exchangeInfo')d={symbols:[{symbol,baseAsset:asset,quoteAsset:'USDT',status:'TRADING',orderTypes:['MARKET'],quoteOrderQtyMarketAllowed:true,baseAssetPrecision:8,quoteAssetPrecision:8,filters:[{filterType:'LOT_SIZE',stepSize:'0.00001000',minQty:'0.00001',maxQty:'1000000'},{filterType:'MIN_NOTIONAL',minNotional:'5'}]}]};
  else if(u.pathname==='/api/v3/order'&&options.method==='POST'){
   const side=u.searchParams.get('side'),quote=Number(u.searchParams.get('quoteOrderQty')||Number(u.searchParams.get('quantity'))*prices[asset]),qty=quote/prices[asset];
   d={symbol,side,orderId:orders.length+1,clientOrderId:u.searchParams.get('newClientOrderId'),status:'FILLED',executedQty:String(qty),cummulativeQuoteQty:String(quote),fills:[{commission:'0',commissionAsset:asset}]};orders.push(d);
   if(side==='BUY'){balances.USDT-=quote;balances[asset]+=qty;}else{balances[asset]-=qty;balances.USDT+=quote;}
   if(timeout)throw Error('Timed out');
  }else if(u.pathname==='/api/v3/order')d=orders.find(o=>o.clientOrderId===u.searchParams.get('origClientOrderId'));
  else if(u.pathname==='/api/v3/myTrades')d=[{commission:'0',commissionAsset:asset}];
  else throw Error('Unexpected request '+u.pathname);
  return {ok:true,json:async()=>d};
 };
 const stateFile=path.join(dir,'state.json');
 const trader=new DemoTrader({key:'demo-key',secret:'demo-secret',enabled:true,stateFile,fetcher});
 return {trader,fetcher,stateFile,orders,balances,prices,requests,close:()=>rmSync(dir,{recursive:true,force:true})};
}
const ev=(symbol,buy=true,sell=false,score=80)=>({ok:true,symbol,score,closedStrategy:{buyConfirmed:buy},strategy:{sellConfirmed:sell}});
test('equal allocation includes realized gains; reserves fees; cap three',()=>{
 assert.equal(allocation(9000,9000,0),2994);assert.equal(allocation(9300,9300,0),3093.8);assert.equal(allocation(9300,3000,2),2994);assert.equal(allocation(9000,9000,3),0);assert.equal(floorQuantity(1.234567,'0.00100000'),'1.234');
});
test('three equal demo buys, no repeat buys, no live endpoints',async()=>{
 const x=setup();try{const es=['BTCUSDT','ETHUSDT','SOLUSDT'].map(s=>ev(s));await x.trader.cycle(es);assert.equal(x.orders.length,3);for(const o of x.orders)assert.equal(Number(o.cummulativeQuoteQty),2994);await x.trader.cycle(es);assert.equal(x.orders.length,3);assert.equal(x.trader.snapshot().currency,'USDT');assert.equal(x.trader.snapshot().activePositions,3);}finally{x.close();}
});
test('SELL realizes profit and next allocation increases',async()=>{
 const x=setup();try{await x.trader.cycle([ev('BTCUSDT')]);x.prices.BTC=110;await x.trader.cycle([ev('BTCUSDT',false,true)]);assert.equal(x.trader.snapshot().activePositions,0);assert.ok(x.trader.snapshot().profitIls>299);await x.trader.cycle([ev('ETHUSDT')]);assert.ok(Number(x.orders.at(-1).cummulativeQuoteQty)>2994);}finally{x.close();}
});
test('USDC is converted in Demo to fund equal USDT positions',async()=>{
 const x=setup({usdt:4500,usdc:4500});try{await x.trader.cycle(['BTCUSDT','ETHUSDT','SOLUSDT'].map(s=>ev(s)));assert.equal(x.orders.filter(o=>o.side==='BUY').length,3);assert.equal(x.orders.filter(o=>o.symbol==='USDCUSDT'&&o.side==='SELL').length,1);assert.ok(x.balances.USDC<0.00002);for(const o of x.orders.filter(o=>o.side==='BUY'))assert.equal(Number(o.cummulativeQuoteQty),2994);}finally{x.close();}
});
test('uncertain accepted order persists and restart queries it without resubmitting',async()=>{
 const x=setup({timeout:true});try{await x.trader.cycle([ev('BTCUSDT')]);assert.equal(x.orders.length,1);assert.ok(JSON.parse(readFileSync(x.stateFile)).pending);const restarted=new DemoTrader({key:'demo-key',secret:'demo-secret',enabled:true,stateFile:x.stateFile,fetcher:x.fetcher});await restarted.cycle([ev('BTCUSDT')]);assert.equal(x.orders.length,1);assert.equal(restarted.snapshot().activePositions,1);assert.equal(restarted.state.pending,null);}finally{x.close();}
});
test('disabled execution and unmanaged holdings never generate orders',async()=>{
 const x=setup();try{x.trader.enabled=false;await x.trader.cycle([ev('BTCUSDT')]);assert.equal(x.orders.length,0);x.trader.enabled=true;x.balances.BTC=2;await x.trader.cycle([ev('BTCUSDT')]);assert.equal(x.orders.length,0);assert.match(x.trader.error,/unmanaged/);}finally{x.close();}
});
test('concurrent cycles only execute one buy',async()=>{
 const x=setup();try{await Promise.all([x.trader.cycle([ev('BTCUSDT')]),x.trader.cycle([ev('BTCUSDT')])]);assert.equal(x.orders.length,1);}finally{x.close();}
});
test('live peak exit sells despite daily UP, survives restart, and does not rebuy the same cycle',async()=>{
 const x=setup();try{
  await x.trader.cycle([ev('BTCUSDT')]);
  assert.equal(x.trader.state.positions.BTCUSDT.peakPrice,100);
  x.prices.BTC=110;await x.trader.cycle([ev('BTCUSDT')]);
  assert.equal(x.orders.length,1);
  const restarted=new DemoTrader({key:'demo-key',secret:'demo-secret',enabled:true,stateFile:x.stateFile,fetcher:x.fetcher});
  x.prices.BTC=109;await restarted.cycle([ev('BTCUSDT')]);assert.equal(x.orders.length,1);
  x.prices.BTC=108.9;await restarted.cycle([ev('BTCUSDT'),ev('ETHUSDT')]);
  assert.equal(restarted.state.positions.BTCUSDT,undefined);
  assert.ok(restarted.state.positions.ETHUSDT);
  assert.equal(x.orders.filter(o=>o.symbol==='BTCUSDT'&&o.side==='BUY').length,1);
  assert.equal(restarted.state.trades[0].exitReason,'TRAILING_STOP');
  assert.equal(restarted.state.actionLog.find(o=>o.type==='SELL').reason,'TRAILING_STOP');
 }finally{x.close();}
});
test('existing positions initialize peak from entry and exit below entry without a wave signal',async()=>{
 const x=setup();try{
  await x.trader.cycle([ev('BTCUSDT')]);delete x.trader.state.positions.BTCUSDT.peakPrice;
  x.prices.BTC=97;await x.trader.cycle([ev('BTCUSDT')]);
  assert.equal(x.trader.snapshot().activePositions,0);
  assert.equal(x.trader.state.trades[0].exitReason,'TRAILING_STOP');
 }finally{x.close();}
});
test('missing ticker does not create a trailing exit or overwrite the peak',async()=>{
 const x=setup();try{
  await x.trader.cycle([ev('BTCUSDT')]);delete x.prices.BTC;
  await x.trader.cycle([ev('BTCUSDT')]);assert.equal(x.orders.length,1);
  assert.equal(x.trader.state.positions.BTCUSDT.peakPrice,100);
 }finally{x.close();}
});
test('independent exit monitor sells without a scan, records execution accuracy, and prevents stale rebuy',async()=>{
 const x=setup();try{
  await x.trader.cycle([ev('BTCUSDT')]);x.prices.BTC=110;
  await x.trader.monitorExits();x.prices.BTC=108;
  await Promise.all([x.trader.monitorExits(),x.trader.monitorExits()]);
  assert.equal(x.orders.filter(o=>o.side==='SELL').length,1);
  const sale=x.trader.state.actionLog[0];assert.equal(sale.reason,'TRAILING_STOP');
  assert.equal(sale.stopPrice,108.9);assert.ok(sale.detectedDrawdownPct>1);
  assert.ok(sale.executedDrawdownPct>1);assert.ok(sale.executionDelayMs>=0);
  await x.trader.cycle([ev('BTCUSDT'),ev('ETHUSDT')]);
  assert.equal(x.trader.state.positions.BTCUSDT,undefined);assert.ok(x.trader.state.positions.ETHUSDT);
 }finally{x.close();}
});
test('exit monitor shares order lock with execution and respects disabled mode',async()=>{
 const x=setup();try{
  await x.trader.cycle([ev('BTCUSDT')]);x.prices.BTC=97;
  x.trader.busy=true;assert.equal(await x.trader.monitorExits(),false);assert.equal(x.orders.length,1);
  x.trader.busy=false;x.trader.enabled=false;
  assert.equal(await x.trader.monitorExits(),false);assert.equal(x.orders.length,1);
 }finally{x.close();}
});
