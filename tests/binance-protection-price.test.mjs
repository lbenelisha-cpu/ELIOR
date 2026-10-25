import test from 'node:test';
import assert from 'node:assert/strict';
import {protectionPrice} from '../lib/binance-protection-price.mjs';
import {requireLivePrice} from '../lib/binance-live-price.mjs';
const symbol='EWYBUSDT',time=1792966387000;
const quote={symbol,lastPrice:'152.61',bidPrice:'152.31',askPrice:'152.37',closeTime:time};
test('protection prefers a fresh stream without making REST requests',async()=>{
 const stream={status:'connected',lastPrice:152.05,lastEventAt:new Date(time).toISOString()};
 assert.equal(await protectionPrice(symbol,stream,()=>{throw Error('unexpected REST');},()=>time),152.05);
});
test('fresh REST ticker arms protection without changing the entry freshness gate',async()=>{
 for(const stream of [{status:'connected',lastPrice:null},{status:'disconnected',lastPrice:151},{status:'connected',lastPrice:151,lastEventAt:new Date(time-60000).toISOString()}]){
  const before={...stream};assert.equal(await protectionPrice(symbol,stream,async path=>{assert.equal(path,'/api/v3/ticker/24hr?symbol=EWYBUSDT');return quote;},()=>time),152.61);
  assert.deepEqual(stream,before);assert.throws(()=>requireLivePrice(stream,time,15000),/Fresh/);
 }
});
test('missing, stale, future, mismatched or invalid REST quotes never arm protection',async()=>{
 for(const patch of [{closeTime:undefined},{closeTime:time-15001},{closeTime:time+5001},{symbol:'BTCUSDT'},{lastPrice:'0'},{lastPrice:'Infinity'},{bidPrice:'0'},{askPrice:'bad'},{bidPrice:'153'}]){
  await assert.rejects(protectionPrice(symbol,null,async()=>({...quote,...patch}),()=>time),/FRESH_QUOTE_REQUIRED/);
 }
});
test('slow or failed REST quote requests fail closed',async()=>{
 let clock=time;await assert.rejects(protectionPrice(symbol,null,async()=>{clock+=15001;return {...quote,closeTime:clock};},()=>clock),/FRESH_QUOTE_REQUIRED/);
 await assert.rejects(protectionPrice(symbol,null,async()=>{throw Error('network');},()=>time),/network/);
 await assert.rejects(protectionPrice('BAD&symbol=BTCUSDT',null,()=>{throw Error('unexpected REST');},()=>time),/SYMBOL_INVALID/);
});
