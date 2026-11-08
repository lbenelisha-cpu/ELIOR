import test from 'node:test';
import assert from 'node:assert/strict';
import {pocFixture} from './helpers/poc-channel-fixture.mjs';
import {channelEntry,channelEntryConfig,assertChannelSubmission} from '../lib/channel-primary-entry.mjs';
import {shortSignal,shortConfig,assertSameShortSignal} from '../lib/futures-short-policy.mjs';
import {POC_MODEL} from '../lib/channel-poc-entry.mjs';
const config=(side,platform='BINANCE')=>side==='LONG'?channelEntryConfig({[platform+'_CHANNEL_PRIMARY_ENABLED']:'true',[platform+'_CHANNEL_PRIMARY_AFTER']:'2026-11-06T16:55Z'},platform):{...shortConfig({BINANCE_FUTURES_SHORT_ENABLED:'true',BINANCE_FUTURES_SHORT_AFTER:'2026-11-06T16:55Z'}),platform};
const D=300000;

for(const side of ['LONG','SHORT'])for(const platform of ['BINANCE','COLMEX'])test(side+' '+platform+' cannot reuse a cached pre-close wave on a fresh return candle',()=>{
 const input=pocFixture({side}),cfg=config(side,platform),evaluate=side==='LONG'?channelEntry:shortSignal;
 const before=evaluate(input,cfg);assert.equal(before.ready,true);
 const entryAfter=input.bars.at(-1).openTime+1;
 assert.ok(input.liveBar.openTime>entryAfter,'new return candle passes the old receipt-only check');
 const reset=evaluate({...input,entryAfter,pocResetAfter:entryAfter},cfg);
 assert.equal(reset.ready,false);assert.equal(reset.conditions.model,null);
 // A different account / lifecycle must not inherit the reset cache entry.
 assert.deepEqual(evaluate(input,cfg),before);
 assert.throws(()=>assertChannelSubmission({...input,entryAfter,pocResetAfter:entryAfter},config('LONG',platform),{entryMode:'channel_breakout',patternId:before.setup.patternId,setup:before.setup}));
});

for(const side of ['LONG','SHORT'])test(side+' rebuilds a new wave after closing, using only post-close A/B and profile candles',()=>{
 const old=pocFixture({side}).bars,entryAfter=old.at(-1).closeTime+1,next=pocFixture({side});
 const offset=old.at(-1).closeTime+D-next.bars[0].openTime;
 const bars=[...old,...next.bars.map(b=>({...b,openTime:b.openTime+offset,closeTime:b.closeTime+offset}))],now=bars.at(-1).closeTime+1;
 const result=POC_MODEL.analyze({bars,side,pocResetAfter:entryAfter,now,price:bars.at(-1).close});
 assert.ok(result.model,'later breakout is still eligible for a new lifecycle');
 const m=result.model;assert.ok(m.anchorA.time>entryAfter);assert.ok(m.anchorB.time>m.anchorA.time);assert.ok(m.breakoutAt>entryAfter);
 assert.deepEqual(m.profile,POC_MODEL.profile(bars.filter(b=>b.openTime>=m.anchorA.time&&b.openTime<=m.anchorB.time)));
 assert.equal(POC_MODEL.analyze({bars,side,pocResetAfter:now,now,price:bars.at(-1).close}).model,null);
});

for(const side of ['LONG','SHORT'])test(side+' requires a full new channel and consolidation, not only new A/B, after closure',()=>{
 const input=pocFixture({side}),cutoff=input.bars[20].closeTime;
 const old=POC_MODEL.analyze({...input,side});assert.equal(old.ready,true);
 const result=POC_MODEL.analyze({...input,side,pocResetAfter:cutoff});
 assert.equal(result.ready,false);assert.equal(result.model,null);
 assert.ok(result.conditions.rows.every(row=>row.state!=='passed'));
 const next=pocFixture({side}),shift=input.bars.at(-1).closeTime+D-next.bars[0].openTime;
 const fresh=next.bars.map(b=>({...b,openTime:b.openTime+shift,closeTime:b.closeTime+shift}));
 const liveBar={...next.liveBar,openTime:next.liveBar.openTime+shift,closeTime:next.liveBar.closeTime+shift};
 const r=POC_MODEL.analyze({bars:[...input.bars,...fresh],side,pocResetAfter:cutoff,now:next.now+shift,liveBar,price:next.price});
 assert.equal(r.ready,true,r.reason);assert.ok(r.conditions.rows.every(row=>row.state==='passed'));
 assert.ok(r.model.channel.startAt>cutoff);assert.ok(r.model.consolidation.startAt>cutoff);assert.ok(r.model.anchorA.time>cutoff);
});
