import test from 'node:test';import assert from 'node:assert/strict';
import {pocFixture} from './helpers/poc-channel-fixture.mjs';
import {POC_MODEL} from '../lib/channel-poc-entry.mjs';
const D=300000;
function waves(side){
 const f=pocFixture(),bars=structuredClone(f.bars);let at=f.liveBar.openTime;
 const add=b=>{bars.push({...b,openTime:at,closeTime:at+D,closed:true});at+=D;};
 add({...f.liveBar,volume:1000});let prior=f.price;
 for(const close of [103.4,103,103.3,103.2,104.1,105.2,106.8,110,112,111.7]){add({open:prior,close,high:Math.max(prior,close)+.1,low:Math.min(prior,close)-.1,volume:close>=110?100:1});prior=close;}
 if(side==='SHORT')for(const b of bars){const {open,close,high,low}=b;Object.assign(b,{open:210-open,close:210-close,high:210-low,low:210-high});}
 return bars;
}
for(const side of ['LONG','SHORT'])test(side+' selects the recent pullback instead of the older global extreme, then follows the wave peak causally',()=>{
 const bars=waves(side),before=structuredClone(bars),models=[];
 for(let n=52;n<=bars.length;n++){
  const prefix=bars.slice(0,n),last=prefix.at(-1),now=last.closeTime+1;
  models.push(POC_MODEL.analyze({bars:prefix,side,now,price:last.close,liveBar:{openTime:last.closeTime,high:last.close,low:last.close}}).model);
 }
 const m=models.at(-1),old=models[0];assert.equal(m.anchorPolicy,'RECENT_WAVE_POC_V2');
 assert.ok(m.anchorA.time>old.anchorB.time);assert.ok(m.anchorB.time>m.anchorA.time);
 assert.equal(m.anchorA.price,side==='LONG'?102.9:107.1);assert.equal(m.anchorB.price,side==='LONG'?112.1:97.9);
 assert.ok(models.some(x=>x?.anchorB.price===(side==='LONG'?110.1:99.9)));
 const selected=bars.filter(b=>b.openTime>=m.anchorA.time&&b.openTime<=m.anchorB.time);
 assert.deepEqual(m.profile,POC_MODEL.profile(selected));assert.deepEqual(bars,before);
 const returnBar={openTime:bars.at(-1).closeTime,closeTime:bars.at(-1).closeTime+D,open:bars.at(-1).close,close:m.profile.poc,high:Math.max(bars.at(-1).close,m.profile.poc)+.01,low:Math.min(bars.at(-1).close,m.profile.poc)-.01,volume:1e8,closed:true};
 const r=POC_MODEL.analyze({bars:[...bars,returnBar],side,now:returnBar.closeTime+1,price:m.profile.poc,liveBar:{openTime:returnBar.closeTime,low:m.profile.poc,high:m.profile.poc}});
 assert.deepEqual(r.model.profile,m.profile);assert.deepEqual(r.model.anchorB,m.anchorB);
 const future={...returnBar,openTime:returnBar.closeTime,closeTime:returnBar.closeTime+D,high:1000,low:.1,closed:false};
 const frozen=POC_MODEL.analyze({bars:[...bars,future],side,now:bars.at(-1).closeTime+1,price:bars.at(-1).close});
 assert.deepEqual(frozen.model,m);
});

test('replaying a later wave does not rewrite a position already opened under the old A/B model',async()=>{
 const {applyTrailingExitPolicy}=await import('../lib/trailing-profit-exit.mjs');
 const p={entryPrice:100,entryAt:1000,qty:2,peakPrice:108,effectiveStopPrice:106,profitFloorArmed:true,exitPolicy:'PROFIT_ACTIVATE5_TRAIL1PP_STOP1_V2',exitSettings:{stopLossPct:2,takeProfitPct:20,profitActivationPct:4,trailingGapPp:2},setup:{pocModel:{version:'CHANNEL_POC_RETEST_V1',anchorA:{time:1,price:90},anchorB:{time:2,price:105}}}};
 const original=structuredClone(p.setup);applyTrailingExitPolicy(p);const stop=p.effectiveStopPrice;
 const bars=waves('LONG');POC_MODEL.analyze({bars,side:'LONG',now:bars.at(-1).closeTime+1,price:111.7});applyTrailingExitPolicy(p);
 assert.deepEqual(p.setup,original);assert.equal(p.effectiveStopPrice,stop);assert.equal(p.qty,2);assert.equal(p.entryPrice,100);
});
test('fast monitoring refreshes a closed-bar boundary before relying on the previous POC price gate',async()=>{
 const {PocFastWatch}=await import('../lib/poc-fast-watch.mjs');let clock=610000;
 const watch=new PocFastWatch({version:'POC_FAST_WATCH_V1',rows:{ABCUSDT:{at:599999,lastPollAt:600000,sides:[{side:'LONG',poc:1,modelId:'old-wave'}]}},turn:0},()=>clock);
 assert.equal(watch.take(['ABCUSDT'],()=>false),'ABCUSDT');
 watch.state.rows.ABCUSDT.at=clock;clock+=2001;
 assert.equal(watch.take(['ABCUSDT'],()=>false),null);
});

for(const side of ['LONG','SHORT'])test(side+' does not enter against an obsolete B when the open candle makes a new extreme',()=>{
 const f=pocFixture({side}),m=POC_MODEL.analyze({...f,side}).model;
 if(side==='LONG')f.liveBar.high=m.anchorB.price+1;else f.liveBar.low=m.anchorB.price-1;
 const r=POC_MODEL.analyze({...f,side});assert.equal(r.ready,false);assert.equal(r.reason,'WAIT_POC_WAVE_CLOSE');assert.deepEqual(r.model,m);
});
