import test from 'node:test';
import assert from 'node:assert/strict';
import {futuresFillPrice} from '../lib/futures-short-fill.mjs';
import {prepareRoundedFillRecovery} from '../lib/futures-short-ownership-recovery.mjs';
const symbol='IDOLUSDT',old=.0234917,qty=1445,exact=33.945447/qty,client='lvs-'+'a'.repeat(28);
const order={symbol,orderId:7,clientOrderId:client,status:'FILLED',side:'SELL',positionSide:'BOTH',type:'LIMIT',timeInForce:'IOC',executedQty:'1445',avgPrice:'0.0234917',cumQuote:'33.9454470'};
function fixture(){
 const state={version:'FUTURES_CHANNEL_SHORT_V1',halt:'FUTURES_POSITION_OWNERSHIP_CHANGED',startedAt:100,used:[{symbol,patternId:'consumed'}],closed:[{reason:'old'}],pending:null,positions:{[symbol]:{symbol,qty,entryPrice:old,entryOrderId:order.orderId,lowPrice:old,targetPrice:.0233447,settings:{stopLossPct:1},algos:[],protectedAt:null}}};
 const account={canTrade:true,multiAssetsMargin:false,positions:[{symbol,positionSide:'BOTH',positionAmt:'-1445',entryPrice:'0.0234916588235',isolated:true,leverage:'1'}]};
 const values={'/fapi/v1/order':structuredClone(order),'/fapi/v2/account':account,'/fapi/v1/positionSide/dual':{dualSidePosition:false},'/fapi/v1/symbolConfig':[{symbol,marginType:'ISOLATED',leverage:1,isAutoAddMargin:false}],'/fapi/v1/openOrders':[],'/fapi/v1/openAlgoOrders':[]};
 const reads=[],api={get:async(p,q)=>{reads.push({p,q});return values[p];},post:()=>assert.fail('GET only'),del:()=>assert.fail('GET only')};
 return {state,values,api,reads};
}
test('actual IDOL rounded average reconciles to cumulative quote without broadening ownership tolerance',()=>{
 assert.equal(futuresFillPrice(order),exact);
 assert.ok(Math.abs(old-exact)>Math.max(1e-8,old*1e-6));
 assert.ok(Math.abs(exact-.0234916588235)<exact*1e-10);
 for(const field of ['cumQuote','executedQty','avgPrice'])for(const bad of [undefined,null,'',0,-1,'NaN','Infinity'])assert.throws(()=>futuresFillPrice({...order,[field]:bad}),/UNVERIFIED/);
 assert.throws(()=>futuresFillPrice({...order,cumQuote:'999'}),/UNVERIFIED/);
});
test('verified recovery changes only price accounting and resume boundary; keeps quantities, target, settings, history',async()=>{
 const h=fixture(),before=structuredClone(h.state),next=await prepareRoundedFillRecovery(h.state,h.api,900);
 assert.deepEqual(h.state,before);assert.equal(next.halt,null);assert.equal(next.resumedAt,900);
 const p=next.positions[symbol];assert.equal(p.entryPrice,exact);assert.equal(p.lowPrice,exact);assert.equal(p.qty,qty);assert.equal(p.targetPrice,before.positions[symbol].targetPrice);
 assert.deepEqual(p.settings,before.positions[symbol].settings);assert.deepEqual(next.used,before.used);assert.deepEqual(next.closed,before.closed);assert.equal(next.startedAt,before.startedAt);
 assert.deepEqual(p.algos,[]);assert.equal(p.protectedAt,null);assert.equal(p.entryClientOrderId,client);
 assert.ok(h.reads.every(r=>r.p.startsWith('/fapi/')));
});
test('recovery refuses true ownership changes, unverifiable evidence, native orders, and protected or ambiguous state',async()=>{
 const cases=[
 h=>h.state.halt='OTHER',h=>h.state.pending={},h=>h.state.positions[symbol].qty++,h=>h.state.positions[symbol].lowPrice-=.0001,
 h=>h.state.positions[symbol].protectedAt=1,h=>h.state.positions[symbol].algos=[{}],h=>h.state.positions[symbol].stopPrice=.03,
 h=>h.values['/fapi/v1/order'].orderId++,h=>h.values['/fapi/v1/order'].clientOrderId='manual',h=>h.values['/fapi/v1/order'].side='BUY',
 h=>h.values['/fapi/v1/order'].type='MARKET',h=>h.values['/fapi/v1/order'].status='NEW',h=>h.values['/fapi/v1/order'].cumQuote='33',
 h=>h.values['/fapi/v2/account'].positions[0].positionAmt='-1446',h=>h.values['/fapi/v2/account'].positions[0].positionAmt='-1444',
 h=>h.values['/fapi/v2/account'].positions[0].entryPrice='.023492',h=>h.values['/fapi/v2/account'].positions[0].positionSide='SHORT',
 h=>h.values['/fapi/v2/account'].positions.push({...h.values['/fapi/v2/account'].positions[0],symbol:'OTHERUSDT'}),
 h=>h.values['/fapi/v1/positionSide/dual'].dualSidePosition=true,h=>h.values['/fapi/v1/symbolConfig'][0].isAutoAddMargin=true,
 h=>h.values['/fapi/v1/openOrders']=[{}],h=>h.values['/fapi/v1/openAlgoOrders']=[{}],h=>h.values['/fapi/v1/openAlgoOrders']=null
 ];
 for(const mutate of cases){const h=fixture();mutate(h);const before=structuredClone(h.state);await assert.rejects(prepareRoundedFillRecovery(h.state,h.api,900));assert.deepEqual(h.state,before);}
});
