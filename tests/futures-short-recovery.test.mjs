import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareShortHaltRelease} from '../lib/futures-short-recovery.mjs';
import {FUTURES_SHORT_POLICY} from '../lib/futures-short-policy.mjs';
const sample=()=>({version:FUTURES_SHORT_POLICY.version,startedAt:100,halt:'FUTURES_API_-2013',pending:null,positions:{},used:[{symbol:'LINKUSDT',patternId:'original'}],closed:[{symbol:'LINKUSDT',qty:2.97,entryPrice:11.425,closedAt:200,reason:'PROTECTION_FAILURE',algos:[{clientAlgoId:'owned-stop',kind:'STOP_MARKET'}]}]});
function exchange(overrides={}){
 const replies={
  '/fapi/v2/account':{canTrade:true,multiAssetsMargin:false,positions:[],assets:[{asset:'USDT',availableBalance:'69.9601248'}]},
  '/fapi/v1/positionSide/dual':{dualSidePosition:false},'/fapi/v1/openOrders':[],'/fapi/v1/openAlgoOrders':[],
  '/fapi/v1/algoOrder':{symbol:'LINKUSDT',clientAlgoId:'owned-stop',side:'BUY',positionSide:'BOTH',orderType:'STOP_MARKET',closePosition:true,algoStatus:'EXPIRED'},...overrides};
 return {get:async p=>structuredClone(replies[p]),post:()=>assert.fail('no exchange mutations'),del:()=>assert.fail('no exchange mutations')};
}
test('verified flat recovery preserves budget history, closed trades and used signals, and adds a new-signal boundary',async()=>{
 const old=sample(),before=structuredClone(old),next=await prepareShortHaltRelease(old,exchange(),300);
 assert.deepEqual(old,before);assert.equal(next.halt,null);assert.equal(next.resumedAt,300);assert.equal(next.startedAt,100);
 assert.deepEqual(next.used,old.used);assert.deepEqual(next.closed,old.closed);assert.equal(next.haltReleases[0].previousHalt,old.halt);
});
test('release refuses different halts, pending orders, open or malformed positions and missing incident evidence',async()=>{
 for(const change of [s=>s.halt='OTHER',s=>s.halt=null,s=>s.pending={},s=>s.positions.X={},s=>s.positions=[],s=>s.closed=[],s=>s.closed[0].reason='MANUAL',s=>s.closed[0].algos=[]]){
  const s=sample();change(s);await assert.rejects(prepareShortHaltRelease(s,exchange(),300),/SHORT_RELEASE/);
 }
});
test('release refuses live exchange positions, open orders, unsafe modes and unverified protection identities',async()=>{
 const account={canTrade:true,multiAssetsMargin:false,positions:[],assets:[{asset:'USDT',availableBalance:'69.96'}]};
 const variants=[
  {'/fapi/v2/account':{...account,positions:[{positionAmt:'-2.97'}]}},
  {'/fapi/v2/account':{...account,positions:[{positionAmt:'unknown'}]}},
  {'/fapi/v2/account':{...account,multiAssetsMargin:true}},
  {'/fapi/v1/positionSide/dual':{dualSidePosition:true}},
  {'/fapi/v1/openOrders':[{}]}, {'/fapi/v1/openAlgoOrders':[{}]},
  {'/fapi/v1/algoOrder':{symbol:'OTHER',algoStatus:'EXPIRED'}},
  {'/fapi/v1/algoOrder':{symbol:'LINKUSDT',clientAlgoId:'owned-stop',side:'BUY',positionSide:'BOTH',orderType:'STOP_MARKET',closePosition:true,algoStatus:'NEW'}}
 ];
 for(const v of variants)await assert.rejects(prepareShortHaltRelease(sample(),exchange(v),300),/SHORT_RELEASE/);
 const api=exchange();api.get=async()=>{throw Error('NETWORK_FAILED');};await assert.rejects(prepareShortHaltRelease(sample(),api,300),/NETWORK_FAILED/);
});
