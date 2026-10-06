import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DemoTrader,allocation,floorQuantity} from './binance-demo-trader.mjs';
function setup({usdt=9000,usdc=0,timeout=false,maxPositions=3}={}){
 const dir=mkdtempSync(path.join(tmpdir(),'demo-test-'));const requests=[],orders=[];
 const balances={USDT:usdt,USDC:usdc,BTC:0,ETH:0,SOL:0,XRP:0,ADA:0,DOGE:0,BNB:0};const prices={BTC:100,ETH:50,SOL:10,XRP:2,ADA:1,DOGE:0.1,BNB:500,USDC:1};
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
 const trader=new DemoTrader({key:'demo-key',secret:'demo-secret',enabled:true,maxPositions,stateFile,fetcher});
 return {trader,fetcher,stateFile,orders,balances,prices,requests,close:()=>rmSync(dir,{recursive:true,force:true})};
}
const ev=(symbol,buy=true,sell=false,score=80)=>({ok:true,symbol,score,at:new Date().toISOString(),entryConfirmed:buy,closedStrategy:{buyConfirmed:buy},strategy:{sellConfirmed:sell}});
test('cost guard blocks buying and USDC conversion; exits remain independent',async()=>{
 const x=setup({usdt:0,usdc:9000});try{
  x.trader.entryCostGuard=async()=>({ok:false,code:'WAIT_SPREAD'});
  await x.trader.cycle([ev('BTCUSDT')]);assert.equal(x.orders.length,0);
  x.trader.entryCostGuard=async()=>({ok:true});await x.trader.cycle([ev('BTCUSDT')]);
  assert.ok(x.trader.state.positions.BTCUSDT);
  x.trader.entryCostGuard=async()=>({ok:false,code:'WAIT_SPREAD'});
  const before=x.orders.length;x.prices.BTC=95;await x.trader.monitorExits();
  assert.equal(x.orders.length,before+1);assert.equal(x.orders.at(-1).side,'SELL');
 }finally{x.close();}
});
test('cost guard rechecks actual allocation immediately before order',async()=>{
 const x=setup();try{
  let calls=0;x.trader.entryCostGuard=async()=>({ok:++calls===1,code:'WAIT_COST'});
  await x.trader.cycle([ev('BTCUSDT')]);assert.equal(calls,2);assert.equal(x.orders.length,0);
 }finally{x.close();}
});
test('equal allocation includes realized gains; reserves fees; cap three',()=>{
 assert.equal(allocation(9000,9000,0,3),2994);assert.equal(allocation(9300,9300,0,3),3093.8);assert.equal(allocation(9300,3000,2,3),2994);assert.equal(allocation(9000,9000,3,3),0);assert.equal(floorQuantity(1.234567,'0.00100000'),'1.234');
});
test('three demo buys consume available cash, no repeats or live endpoints',async()=>{
 const x=setup();try{const es=['BTCUSDT','ETHUSDT','SOLUSDT'].map(s=>ev(s));await x.trader.cycle(es);assert.equal(x.orders.length,3);for(const o of x.orders)assert.ok(Number(o.cummulativeQuoteQty)>=2994&&Number(o.cummulativeQuoteQty)<3007);await x.trader.cycle(es);assert.equal(x.orders.length,3);assert.equal(x.trader.snapshot().currency,'USDT');assert.equal(x.trader.snapshot().activePositions,3);}finally{x.close();}
});
test('SELL realizes profit and next allocation increases',async()=>{
 const x=setup();try{await x.trader.cycle([ev('BTCUSDT')]);x.prices.BTC=110;await x.trader.cycle([ev('BTCUSDT',false,true)]);assert.equal(x.trader.snapshot().activePositions,0);assert.ok(x.trader.snapshot().profitIls>299);await x.trader.cycle([ev('ETHUSDT')]);assert.ok(Number(x.orders.at(-1).cummulativeQuoteQty)>2994);}finally{x.close();}
});
test('USDC is converted in Demo to fund equal USDT positions',async()=>{
 const x=setup({usdt:4500,usdc:4500});try{await x.trader.cycle(['BTCUSDT','ETHUSDT','SOLUSDT'].map(s=>ev(s)));assert.equal(x.orders.filter(o=>o.side==='BUY').length,3);assert.equal(x.orders.filter(o=>o.symbol==='USDCUSDT'&&o.side==='SELL').length,1);assert.ok(x.balances.USDC<0.00002);for(const o of x.orders.filter(o=>o.side==='BUY'))assert.ok(Number(o.cummulativeQuoteQty)>=2994&&Number(o.cummulativeQuoteQty)<3007);}finally{x.close();}
});
test('uncertain accepted order persists and restart queries it without resubmitting',async()=>{
 const x=setup({timeout:true});try{await x.trader.cycle([ev('BTCUSDT')]);assert.equal(x.orders.length,1);assert.ok(JSON.parse(readFileSync(x.stateFile)).pending);const restarted=new DemoTrader({key:'demo-key',secret:'demo-secret',enabled:true,maxPositions:3,stateFile:x.stateFile,fetcher:x.fetcher});await restarted.cycle([ev('BTCUSDT')]);assert.equal(x.orders.length,1);assert.equal(restarted.snapshot().activePositions,1);assert.equal(restarted.state.pending,null);}finally{x.close();}
});
test('disabled execution sends no orders; unmanaged holdings are never sold',async()=>{
 const x=setup();try{
  x.trader.enabled=false;await x.trader.cycle([ev('BTCUSDT')]);assert.equal(x.orders.length,0);
  x.trader.enabled=true;x.balances.BTC=2;await x.trader.cycle([ev('BTCUSDT')]);
  const tracked=x.trader.state.positions.BTCUSDT.qty;
  assert.ok(Math.abs(x.balances.BTC-tracked-2)<1e-8);
  await x.trader.cycle([ev('BTCUSDT',false,true)]);
  assert.ok(Math.abs(x.balances.BTC-2)<0.0001);
 }finally{x.close();}
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
  const restarted=new DemoTrader({key:'demo-key',secret:'demo-secret',enabled:true,maxPositions:3,stateFile:x.stateFile,fetcher:x.fetcher});
  x.prices.BTC=109;await restarted.cycle([ev('BTCUSDT')]);assert.equal(x.orders.length,1);
  x.prices.BTC=108.9;await restarted.cycle([ev('BTCUSDT'),ev('ETHUSDT')]);
  assert.equal(restarted.state.positions.BTCUSDT,undefined);
  assert.ok(restarted.state.positions.ETHUSDT);
  assert.equal(x.orders.filter(o=>o.symbol==='BTCUSDT'&&o.side==='BUY').length,1);
  assert.equal(restarted.state.trades[0].exitReason,'TRAILING_PROFIT');
  assert.equal(restarted.state.actionLog.find(o=>o.type==='SELL').reason,'TRAILING_PROFIT');
 }finally{x.close();}
});
test('existing positions initialize peak from entry and exit below entry without a wave signal',async()=>{
 const x=setup();try{
  await x.trader.cycle([ev('BTCUSDT')]);delete x.trader.state.positions.BTCUSDT.peakPrice;
  x.prices.BTC=97;await x.trader.cycle([ev('BTCUSDT')]);
  assert.equal(x.trader.snapshot().activePositions,0);
  assert.equal(x.trader.state.trades[0].exitReason,'STOP_LOSS');
 }finally{x.close();}
});
test('small dip after entry is tolerated but the initial 2.5% stop still limits loss',async()=>{
 const x=setup();try{
  await x.trader.cycle([ev('BTCUSDT')]);
  x.prices.BTC=99;await x.trader.cycle([ev('BTCUSDT')]);
  assert.equal(x.trader.snapshot().activePositions,1);
  assert.equal(x.orders.filter(o=>o.side==='SELL').length,0);
  x.prices.BTC=97.4;await x.trader.cycle([ev('BTCUSDT')]);
  assert.equal(x.trader.snapshot().activePositions,0);
  assert.equal(x.trader.state.trades[0].exitReason,'STOP_LOSS');
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
  const sale=x.trader.state.actionLog[0];assert.equal(sale.reason,'TRAILING_PROFIT');
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
test('six slots divide all available cash and never open a seventh position',async()=>{
 const x=setup({usdt:12000,maxPositions:6});try{
  const es=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','BNBUSDT'].map(s=>ev(s));
  await x.trader.cycle(es);assert.equal(x.orders.length,6);
  assert.equal(x.trader.snapshot().activePositions,6);assert.equal(x.trader.snapshot().maxPositions,6);
  assert.equal(Number(x.orders[0].cummulativeQuoteQty),1996);
  assert.ok(x.balances.USDT<5);await x.trader.cycle(es);assert.equal(x.orders.length,6);
 }finally{x.close();}
});
test('last free slot receives all cash even when it exceeds one sixth of capital',()=>{
 assert.equal(allocation(12000,5000,5,6),4990);
 assert.equal(allocation(12000,6000,3,6),1996);
 assert.equal(allocation(12000,12000,6,6),0);
});
test('external reset releases stale slots and archives costs without sales or fake losses',async()=>{
 const x=setup();try{
  await x.trader.cycle(['BTCUSDT','ETHUSDT','SOLUSDT'].map(s=>ev(s)));
  const before=x.orders.length, initial=x.trader.state.initialUsdt;
  x.balances.BTC=0;x.balances.ETH=0;x.balances.SOL=0;x.balances.USDT=10000;
  await x.trader.refresh();
  assert.equal(x.trader.snapshot().activePositions,0);assert.equal(x.orders.length,before);
  assert.equal(x.trader.state.trades.length,0);assert.equal(x.trader.state.initialUsdt,initial);
  assert.equal(x.trader.state.reconciliations.length,3);
  await x.trader.refresh();assert.equal(x.trader.state.reconciliations.length,3);
  const restarted=new DemoTrader({key:'demo-key',secret:'demo-secret',enabled:true,maxPositions:3,stateFile:x.stateFile,fetcher:x.fetcher});
  await restarted.refresh();assert.equal(restarted.snapshot().activePositions,0);
  await restarted.cycle([ev('BTCUSDT')]);assert.equal(x.orders.length,before+1);
  assert.ok(Number(x.orders.at(-1).cummulativeQuoteQty)<3334);
 }finally{x.close();}
});
test('pending recovery never discards a holding based on a missing balance',async()=>{
 const x=setup();try{
  await x.trader.cycle([ev('BTCUSDT')]);x.balances.BTC=0;
  x.trader.state.pending={clientId:'unresolved'};
  await x.trader.refresh();assert.ok(x.trader.state.positions.BTCUSDT);
 }finally{x.close();}
});
test('expired scan cannot buy even when entry conditions were previously confirmed',async()=>{
 const x=setup();try{
  await x.trader.cycle([{...ev('BTCUSDT'),priceAsOf:new Date(Date.now()-120000).toISOString()}]);
  assert.equal(x.orders.length,0);assert.equal(x.trader.state.lastCycle.attempts[0].reason,'STALE_EVALUATION');
 }finally{x.close();}
});
test('a rejected stop for one symbol does not skip stops on other symbols',async()=>{
 const x=setup();try{
  await x.trader.cycle([ev('BTCUSDT'),ev('ETHUSDT')]);x.prices.BTC=96;x.prices.ETH=48;
  const original=x.trader.sell.bind(x.trader);
  x.trader.sell=async(e,r)=>{if(e.symbol==='BTCUSDT')throw Error('symbol unavailable');return original(e,r);};
  assert.equal(await x.trader.monitorExits(),false);
  assert.ok(x.trader.state.positions.BTCUSDT);assert.equal(x.trader.state.positions.ETHUSDT,undefined);
  assert.match(x.trader.error,/BTCUSDT/);
 }finally{x.close();}
});
