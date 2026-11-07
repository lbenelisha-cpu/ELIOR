import test from 'node:test';import assert from 'node:assert/strict';
import {pocFixture} from './helpers/poc-channel-fixture.mjs';
import {channelEntryConfig,channelEntry,assertChannelSubmission} from '../lib/channel-primary-entry.mjs';
import {shortConfig,shortSignal,assertSameShortSignal} from '../lib/futures-short-policy.mjs';
test('installed LONG and SHORT require the initial channel consolidation and preserve it inside the frozen model',()=>{
 for(const side of ['LONG','SHORT']){const i=pocFixture({side}),short=side==='SHORT',config=short?shortConfig({BINANCE_FUTURES_SHORT_ENABLED:'true',BINANCE_FUTURES_SHORT_AFTER:'2026-01-01'}):channelEntryConfig({BINANCE_CHANNEL_PRIMARY_ENABLED:'true',BINANCE_CHANNEL_PRIMARY_AFTER:'2026-01-01'}),r=(short?shortSignal:channelEntry)(i,config);assert.equal(r.ready,true,r.reason);assert.equal(r.model.consolidation.version,'CHANNEL_INITIAL_CONSOLIDATION_V2');assert.equal(r.model.consolidation.zone,short?'UPPER':'LOWER');assert.ok(r.model.consolidation.startAt<=r.model.channel.anchorAt);assert.ok(r.model.consolidation.endAt>r.model.channel.anchorAt);assert.ok(r.model.consolidation.endAt<r.model.breakoutAt);
 const altered=structuredClone(r.setup);altered.pocModel.consolidation.passed=false;
 if(short)assert.throws(()=>assertSameShortSignal(r.setup,altered),/POC_MODEL_CHANGED/);else assert.throws(()=>assertChannelSubmission(i,config,{entryMode:'channel_breakout',patternId:r.setup.patternId,setup:altered}),/POC_MODEL_CHANGED/);}
});
