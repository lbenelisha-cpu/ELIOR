import test from 'node:test';
import assert from 'node:assert/strict';
import {channelEntryConfig,channelEntry,assertChannelSubmission} from '../lib/channel-primary-entry.mjs';
import {shortConfig,shortSignal,assertSameShortSignal} from '../lib/futures-short-policy.mjs';
const D=300000,end=Date.parse('2026-11-02T15:00Z'),now=end+1000;
function sample(short=false){
 const bars=Array.from({length:50},(_,j)=>{const i=j+155,p=100+i*.02+Math.cos(i*Math.PI/5),v=short?210-p:p;return {openTime:end-(50-j)*D,closeTime:end-(49-j)*D,open:v,close:v,high:v+.1,low:v-.1,volume:1000,closed:true};});
 for(const [i,b] of bars.slice(-3).entries()){const p=(short?105.95:104.05)+(i===1?.01:0);Object.assign(b,{open:p,close:p,high:p+.1,low:p-.1});}
 const price=short?104:106;
 return {bars,price,priceAsOf:now,now,liveBar:{openTime:end,closeTime:end+D,open:105,close:price,high:short?105.1:106.1,low:short?103.9:104.9,volume:2000,closed:false,receivedAt:now}};
}
test('installed Binance LONG and SHORT policies enforce and persist the same central consolidation rule',()=>{
 const longConfig=channelEntryConfig({BINANCE_CHANNEL_PRIMARY_ENABLED:'true',BINANCE_CHANNEL_PRIMARY_AFTER:new Date(end-D).toISOString()});
 const futuresConfig=shortConfig({BINANCE_FUTURES_SHORT_ENABLED:'true',BINANCE_FUTURES_SHORT_AFTER:new Date(end-D).toISOString()});
 for(const short of [false,true]){
  const i=sample(short),config=short?futuresConfig:longConfig,evaluate=short?shortSignal:channelEntry,r=evaluate(i,config);
  assert.equal(r.ready,true,r.reason);assert.equal(r.setup.consolidation.zone,'MIDDLE');assert.equal(r.setup.consolidation.passed,true);
  assert.equal(r.setup.consolidation.endAt,end);
  assert.equal(config.consolidationPolicy.version,'CHANNEL_CONSOLIDATION_V1');
  const old={...r.setup};delete old.consolidation;
  if(short)assert.throws(()=>assertSameShortSignal(r.setup,old),/CONSOLIDATION_CHANGED/);
  else assert.throws(()=>assertChannelSubmission(i,config,{entryMode:'channel_breakout',patternId:r.setup.patternId,setup:old}),/CONSOLIDATION_CHANGED/);
  // Replace the recent neutral range with the original directional wave.
  // The latest remaining range is on the wrong edge for this candidate.
  for(let j=47;j<50;j++){const n=j+155,v=100+n*.02+Math.cos(n*Math.PI/5),p=short?210-v:v;Object.assign(i.bars[j],{open:p,close:p,high:p+.1,low:p-.1});}
  const rejected=evaluate(i,config);assert.equal(rejected.ready,false);assert.equal(rejected.reason,'CHANNEL_CONSOLIDATION_SIDE_BLOCK');
 }
});
