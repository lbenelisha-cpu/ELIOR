import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DemoTrader,allocation,floorQuantity} from '../lib/binance-demo-trader.mjs';
export function setup({usdt=9000,usdc=0,timeout=false,maxPositions=3}={}){
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
