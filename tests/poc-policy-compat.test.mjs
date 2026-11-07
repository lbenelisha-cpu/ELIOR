import test from 'node:test';
import assert from 'node:assert/strict';
import {validateChannelProfitEntry} from '../lib/channel-profit-protection.mjs';
import {shortOrderPlan} from '../lib/futures-short-policy.mjs';
const settings={takeProfitPct:5};
const long={entryMode:'channel_breakout',channelProtection:{version:'CHANNEL_TAKE_PROFIT_V2',targetPrice:104,breakoutPrice:100,width:4}};
const info={symbol:'ABCUSDT',contractType:'PERPETUAL',quoteAsset:'USDT',marginAsset:'USDT',status:'TRADING',filters:[{filterType:'LOT_SIZE',stepSize:'0.001',minQty:'0.001',maxQty:'100000'},{filterType:'PRICE_FILTER',tickSize:'0.01'},{filterType:'MIN_NOTIONAL',notional:'5'}]};
const quote={bidPrice:'100',askPrice:'100.01'};
for(const pocPolicy of ['CHANNEL_POC_RETEST_V1','CHANNEL_POC_RETEST_V2'])test(pocPolicy+' preserves settings-only entry semantics on both sides',()=>{
 assert.doesNotThrow(()=>validateChannelProfitEntry({...long,pocPolicy},105,settings));
 const order=shortOrderPlan(info,quote,{targetPrice:110,pocPolicy},35);
 assert.equal(order.side,'SELL');assert.equal(order.type,'LIMIT');assert.ok(Number(order.quantity)*Number(order.price)<=35);
});
test('legacy and unknown policies retain their original channel-target guard',()=>{
 for(const pocPolicy of [undefined,'UNKNOWN_POLICY']){
  assert.throws(()=>validateChannelProfitEntry({...long,pocPolicy},105,settings),/CHANNEL_TARGET_ALREADY_REACHED/);
  assert.throws(()=>shortOrderPlan(info,quote,{targetPrice:110,pocPolicy},35),/SHORT_TARGET_ALREADY_REACHED/);
 }
});
