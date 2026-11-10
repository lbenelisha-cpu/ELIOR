import test from 'node:test';import assert from 'node:assert/strict';
import {FuturesShortRunner} from '../lib/futures-short-runner.mjs';import {PocFastWatch} from '../lib/poc-fast-watch.mjs';
import {shortConfig,shortSignal} from '../lib/futures-short-policy.mjs';import {pocFixture} from './helpers/poc-channel-fixture.mjs';
test('Futures scheduling revisits prepared candidates, keeps discovery turns and dispatches through the existing entry method',async()=>{
 const i=pocFixture({side:'SHORT'});let now=i.now;const config=shortConfig({BINANCE_FUTURES_SHORT_ENABLED:'true',BINANCE_FUTURES_SHORT_AFTER:new Date(now-300000).toISOString()});
 const runner=new FuturesShortRunner({api:{},file:'/unused',config,now:()=>now,save:()=>{},control:()=>({allowEntries:true})});
 // Exercise the actual cycle scheduler; normal account/protection behavior is
 // separately exercised by every unchanged futures-short execution test.
 runner.recover=async()=>{};runner.snapshot=async()=>({availableUsdt:70});runner.manage=async()=>{};runner.assertAccount=()=>{};
 runner.universe=['DEFUSDT','GHIUSDT','ABCUSDT'];runner.marketAt=now;
 const wait=structuredClone(i);wait.price-=.1;wait.liveBar.high=wait.liveBar.close=wait.price;
 const seen=[],calls=[];let ready=false;
 runner.input=async symbol=>{seen.push(symbol);const data=structuredClone(ready&&symbol==='ABCUSDT'?i:wait);data.now=data.priceAsOf=data.liveBar.receivedAt=now;return data;};
 runner.enter=async(symbol,result)=>{assert.equal(result.ready,true);calls.push(symbol);runner.state.positions[symbol]={symbol};};
 runner.pocWatch=new PocFastWatch({},()=>now);runner.pocWatch.observe('ABCUSDT',shortSignal(wait,config));
 for(let n=0;n<4;n++){await runner.cycle();now+=2000;}
 assert.deepEqual(seen,['ABCUSDT','ABCUSDT','ABCUSDT','DEFUSDT']);assert.equal(calls.length,0);
 ready=true;for(let n=0;n<6;n++){await runner.cycle();now+=2000;}
 assert.deepEqual(calls,['ABCUSDT']);assert.ok(seen.includes('GHIUSDT'),'discovery must continue');
});
