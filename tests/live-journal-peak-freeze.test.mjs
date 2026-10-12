import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const body=source.slice(source.indexOf('function persistLivePeak('),source.indexOf('\nlet liveExecutionInFlight=',source.indexOf('function persistLivePeak(')));
function run(actions,peak){let saves=0;const ctx={liveActionLog:actions,saveLiveActionLog(){saves++;return true;}};vm.createContext(ctx);vm.runInContext(body,ctx);ctx.persistLivePeak('BTCUSDT',{peakPrice:peak});return saves;}
const buy=peak=>({type:'BUY',symbol:'BTCUSDT',wyckoffTrade:{peakPrice:peak}});
test('open trade persists increasing peak',()=>{const a=buy(100);assert.equal(run([a],110),1);assert.equal(a.wyckoffTrade.peakPrice,110);});
test('sold trade peak stays frozen when dust remains',()=>{const a=buy(110);assert.equal(run([{type:'SELL',symbol:'BTCUSDT',qty:.99},a],130),0);assert.equal(a.wyckoffTrade.peakPrice,110);});
test('new purchase updates independently of older sold entry',()=>{const newest=buy(120),older=buy(110);assert.equal(run([newest,{type:'SELL',symbol:'BTCUSDT'},older],130),1);assert.equal(newest.wyckoffTrade.peakPrice,130);assert.equal(older.wyckoffTrade.peakPrice,110);});
test('other symbol sale does not freeze open trade',()=>{const a=buy(100);assert.equal(run([{type:'SELL',symbol:'ETHUSDT'},a],110),1);});
