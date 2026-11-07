import test from 'node:test';
import assert from 'node:assert/strict';
import {pocFixture} from './helpers/poc-channel-fixture.mjs';
import {channelEntry,channelEntryConfig,assertChannelSubmission} from '../lib/channel-primary-entry.mjs';
import {shortSignal,shortConfig,assertSameShortSignal} from '../lib/futures-short-policy.mjs';
import {POC_MODEL} from '../lib/channel-poc-entry.mjs';
const config=(side,platform='BINANCE')=>side==='LONG'?channelEntryConfig({[platform+'_CHANNEL_PRIMARY_ENABLED']:'true',[platform+'_CHANNEL_PRIMARY_AFTER']:'2026-11-06T16:55Z'},platform):{...shortConfig({BINANCE_FUTURES_SHORT_ENABLED:'true',BINANCE_FUTURES_SHORT_AFTER:'2026-11-06T16:55Z'}),platform};
for(const side of ['LONG','SHORT'])for(const platform of ['BINANCE','COLMEX'])test(side+' '+platform+' has exactly four gates and enters at POC after a completed breakout',()=>{
 const i=pocFixture({side}),r=(side==='LONG'?channelEntry:shortSignal)(i,config(side,platform));
 assert.equal(r.ready,true,r.reason);assert.deepEqual(r.conditions.rows.map(r=>r.id),['channel','break','poc','range']);
 assert.ok(r.conditions.rows.every(r=>r.state==='passed'));assert.equal(r.setup.pocModel.consolidation.zone,side==='LONG'?'LOWER':'UPPER');
 assert.ok(r.setup.pocModel.consolidation.startAt<=r.setup.pocModel.consolidation.anchorAt);
 assert.equal(r.setup.pocModel.anchorB.time,i.bars.at(-2).openTime);assert.ok(Math.abs(r.setup.poc-i.price)<1e-9);
 assert.equal(i.liveBar.volume,0);assert.ok(r.setup.pocModel.profile.totalVolume<1);
});
test('breakout is preparation only; no purchase before a later return',()=>{
 const i=pocFixture(),c=config('LONG');i.price+=.1;i.liveBar.low=i.price;i.liveBar.close=i.price;
 const r=channelEntry(i,c);assert.equal(r.ready,false);assert.equal(r.reason,'WAIT_POC_RETEST');assert.equal(r.conditions.rows.find(r=>r.id==='break').state,'passed');
});
test('profile is frozen at B and excludes return candles',()=>{
 const i=pocFixture(),c=config('LONG'),a=channelEntry(i,c);i.bars.at(-1).volume=1e9;i.liveBar.volume=1e9;
 const b=channelEntry(i,c);assert.equal(b.ready,true,b.reason);assert.deepEqual(a.setup.pocModel,b.setup.pocModel);
});
test('a new return may use the same channel; duplicate order event cannot be resubmitted',()=>{
 const i=pocFixture(),c=config('LONG'),r=channelEntry(i,c);
 assert.equal(channelEntry({...i,usedPatternIds:[r.setup.pocModel.id]},c).ready,true);
 const again=channelEntry({...i,usedPatternIds:[r.setup.patternId]},c);assert.equal(again.ready,false);assert.equal(again.executionBlock,'DUPLICATE_RETURN_RECEIPT');assert.ok(again.conditions.rows.every(r=>r.state==='passed'));
});
test('late consolidation cannot replace the beginning of the channel',()=>{
 const i=pocFixture(),c=config('LONG');
 for(let j=24;j<30;j++){const b=i.bars[j];b.high=103;b.low=j===28?100:100.1;}
 const r=channelEntry(i,c);assert.equal(r.ready,false);assert.notEqual(r.conditions.rows.find(r=>r.id==='range').state,'passed');
});
test('final check rejects changed POC geometry, wrong side and stale price without an order',()=>{
 const i=pocFixture(),c=config('LONG'),r=channelEntry(i,c),trade={entryMode:'channel_breakout',patternId:r.setup.patternId,setup:r.setup};
 assert.doesNotThrow(()=>assertChannelSubmission(i,c,trade));
 assert.throws(()=>assertChannelSubmission(i,c,{...trade,setup:{...trade.setup,pocModel:{...trade.setup.pocModel,side:'SHORT'}}}),/POC_MODEL_CHANGED/);
 assert.throws(()=>assertChannelSubmission({...i,priceAsOf:i.now-16000},c,trade),/FRESH_PRICE/);
 const si=pocFixture({side:'SHORT'}),s=shortSignal(si,config('SHORT')).setup;
 assert.throws(()=>assertSameShortSignal(s,{...s,pocModel:{...s.pocModel,profile:{...s.pocModel.profile,poc:1}}}),/POC_MODEL_CHANGED/);
});
test('volume profile conserves volume and rejects missing, negative or nonfinite data',()=>{
 const bars=[{low:10,high:12,volume:100},{low:11,high:11,volume:40}],p=POC_MODEL.profile(bars);
 assert.ok(Math.abs(p.totalVolume-140)<1e-8);assert.equal(p.poc,p.low+(p.index+.5)*p.step);
 for(const bad of [undefined,-1,NaN])assert.equal(POC_MODEL.profile([{low:10,high:12,volume:bad}]),null);
});
