import test from 'node:test';import assert from 'node:assert/strict';
import {createMarketLoadGate} from '../lib/colmex-market-loading.mjs';
test('selected chart is serialized and takes priority over background quotes',()=>{
 let time=1000;const gate=createMarketLoadGate(()=>time);
 assert.equal(gate.quoteAllowed(),true);assert.equal(gate.begin('AMD:5min'),true);
 assert.equal(gate.begin('SHOP:5min'),false);assert.equal(gate.quoteAllowed(),false);
 gate.finish('AMD:5min',true);assert.equal(gate.begin('SHOP:5min'),true);
 gate.finish('SHOP:5min',true);time+=1500;assert.equal(gate.quoteAllowed(),true);
});
test('rate-limited charts wait, retry after 65 seconds and cannot be bypassed by repeated clicks',()=>{
 let time=1000;const gate=createMarketLoadGate(()=>time);
 gate.begin('AMD:5min');gate.finish('AMD:5min',false);
 assert.equal(gate.retryAt('AMD:5min'),66000);assert.equal(gate.quoteAllowed(),false);
 for(let i=0;i<10;i++)assert.equal(gate.begin('AMD:5min'),false);
 time=66000;assert.equal(gate.begin('AMD:5min'),true);gate.finish('AMD:5min',true);assert.equal(gate.retryAt('AMD:5min'),0);
});
test('one failing stock does not block selecting a different stock or interval',()=>{
 const gate=createMarketLoadGate(()=>1000);gate.begin('AMD:5min');gate.finish('AMD:5min',false);
 assert.equal(gate.begin('SHOP:5min'),true);gate.finish('SHOP:5min',true);
 assert.equal(gate.begin('AMD:1day'),true);
});

test('daily quota waits until the supplied reset time while other stocks can use cached data',()=>{
 let time=1000;const gate=createMarketLoadGate(()=>time);gate.begin('AMD:5min');gate.finish('AMD:5min',false,3600000);
 time+=65000;assert.equal(gate.begin('AMD:5min'),false);assert.equal(gate.begin('AAPL:5min'),true);gate.finish('AAPL:5min',true);
 time=3601000;assert.equal(gate.begin('AMD:5min'),true);
});
