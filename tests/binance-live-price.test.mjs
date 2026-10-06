import test from 'node:test';
import assert from 'node:assert/strict';
import {requireLivePrice} from '../lib/binance-live-price.mjs';
const now = Date.parse('2026-10-06T12:00:00Z');
const fresh = {status:'connected',lastPrice:0.03123,lastEventAt:new Date(now-1000).toISOString()};
test('accepts a fresh connected price without rounding',()=>assert.equal(requireLivePrice(fresh,now),0.03123));
test('rejects absent, disconnected, stale, invalid and future prices',()=>{
  for(const stream of [undefined,{...fresh,status:'disconnected'},
    {...fresh,lastEventAt:new Date(now-90001).toISOString()},
    {...fresh,lastEventAt:undefined},{...fresh,lastPrice:0},
    {...fresh,lastPrice:NaN},{...fresh,lastEventAt:new Date(now+10000).toISOString()}]) {
    assert.throws(()=>requireLivePrice(stream,now),/Fresh connected/);
  }
});
