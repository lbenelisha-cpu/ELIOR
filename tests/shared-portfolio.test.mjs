import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedPortfolio,sharedAllocation,SharedEntryLock,installSharedPortfolio} from '../lib/shared-portfolio.mjs';
const at=Date.now();
const spot=()=>({connected:true,canTrade:true,totalValueUsdt:600,usdtFree:500,balances:[{asset:'BTC',qty:.001,usdtPrice:100000,valueUsdt:100}]});
const futures=()=>({canTrade:true,assets:[{asset:'USDT',walletBalance:'300',unrealizedProfit:'-3',availableBalance:'300'}],positions:[]});
const state=(extra={})=>sharedPortfolio({spot:spot(),futures:futures(),at,...extra});
test('combined equity counts wallet plus PnL once; fee reserve and one-third use current equity',()=>{
 const s=state();assert.equal(s.equityUsdt,897);assert.equal(s.grossSlotUsdt,299);
 assert.equal(sharedAllocation(s,'SHORT',{now:at}).amountUsdt,299);
 const a=sharedAllocation(s,'LONG',{now:at});assert.equal(a.amountUsdt,298.4);assert(a.requiredUsdt<=299);
});
test('union actual and managed holdings, dust excluded; LONG/SHORT same symbol occupy two slots',()=>{
 const s=spot();s.balances.push({asset:'ETH',qty:.0001,usdtPrice:100,valueUsdt:.01});
 const f=futures();f.positions=[{symbol:'BTCUSDT',positionAmt:'-.001'}];
 const r=state({spot:s,futures:f,longManaged:{BTCUSDT:{}},shortManaged:{BTCUSDT:{},SOLUSDT:{}}});
 assert.equal(r.activePositions,3);assert.equal(r.longPositions,1);assert.equal(r.shortPositions,2);
 assert.equal(sharedAllocation(r,'SHORT',{now:at}).code,'SHARED_THREE_SLOTS_FULL');
 delete r.pending;const reopened=state({longManaged:{BTCUSDT:{}},shortManaged:{SOLUSDT:{}}});assert.equal(reopened.freeSlots,1);
});
test('missing wallet funds never shrinks the third or requests a transfer',()=>{
 const f=futures();f.assets[0].availableBalance='40';const a=sharedAllocation(state({futures:f}),'SHORT',{now:at});
 assert.equal(a.code,'SHARED_WALLET_FUNDS_REQUIRED');assert.equal(a.missingUsdt,259);assert.equal(a.maxOrderUsdt,0);assert.equal(a.amountUsdt,299);
});
test('stale, unknown prices, disabled account and unresolved orders block entry',()=>{
 assert.equal(sharedAllocation(state(),'LONG',{now:at+15000}).code,'SHARED_ACCOUNT_UNVERIFIED');
 assert.equal(sharedAllocation(state({pending:true}),'LONG',{now:at}).code,'SHARED_ORDER_PENDING');
 const s=spot();s.balances[0].usdtPrice=0;assert.throws(()=>state({spot:s}),/UNVERIFIED/);
 assert.throws(()=>state({futures:{...futures(),canTrade:false}}),/UNVERIFIED/);
});
function fixture(){
 let clock=at,fail=false,spotCalls=0,shortCalls=0;
 const f={config:{maxPositions:2},state:{positions:{},pending:null},api:{get:async()=>{if(fail)throw Error('NETWORK');return futures();}},snapshot:async()=>({}),submit:async function(kind){shortCalls++;if(kind==='ENTRY'){this.state.pending={kind};await this.snapshot();this.assertAllocation(299);this.state.positions.SOLUSDT={};this.state.pending=null;}return kind;}};
 const orders={pending:null,submit:async()=>{spotCalls++;return 'sent';}};
 const manager=installSharedPortfolio({futuresShort:f,readSpot:async()=>{if(fail)throw Error('NETWORK');return spot();},longManaged:()=>({}),spotOrders:orders,maxLongUsdt:400,now:()=>clock});
 return {f,orders,manager,fail:()=>fail=true,advance:()=>clock+=20000,calls:()=>({spotCalls,shortCalls})};
}
test('shared lock rejects concurrent direction while allowing exit; unlocks on failure',async()=>{
 const x=fixture();let release;const blocker=new Promise(r=>release=r);
 const long=x.manager.runLong(()=>blocker);await new Promise(r=>setImmediate(r));
 await assert.rejects(x.f.submit('ENTRY',{}, {slotBudgetUsdt:299}),/SHARED_ENTRY_BUSY/);
 assert.equal(await x.f.submit('EXIT',{}),'EXIT');release();await long;
 await x.f.submit('ENTRY',{}, {slotBudgetUsdt:299});assert.equal(x.f.config.maxPositions,3);
});
test('final spot submit rechecks shared slots and persists no order on failure',async()=>{
 const x=fixture();await x.manager.runLong(async()=>{
 x.f.state.positions={ETHUSDT:{},SOLUSDT:{}};
 await assert.rejects(x.orders.submit({side:'BUY',quoteOrderQty:'298.4'}),/SHARED_THREE_SLOTS_FULL/);
 });assert.equal(x.calls().spotCalls,0);
 await assert.rejects(x.orders.submit({side:'BUY',quoteOrderQty:'298.4'}),/LOCK_REQUIRED/);
});
test('unknown order after lock release blocks both directions; exits bypass shared funding failure',async()=>{
 const x=fixture();await assert.rejects(x.manager.runLong(async()=>{x.orders.pending={};throw Error('TIMEOUT');}),/TIMEOUT/);
 await assert.rejects(x.f.submit('ENTRY',{}, {slotBudgetUsdt:299}),/SHARED_ORDER_PENDING/);
 await assert.rejects(x.manager.runLong(()=>{}),/SHARED_ORDER_PENDING/);
 x.fail();x.advance();await x.f.snapshot();assert.equal(x.manager.status(),null);
 assert.equal(await x.f.submit('EXIT',{}),'EXIT');assert.equal(await x.orders.submit({side:'SELL'}),'sent');
});
test('entry budget is revalidated and snapshot exposes shared policy without altering holdings',async()=>{
 const x=fixture();await x.manager.refresh(true);const s=spot(),d=x.manager.decorate(s);
 assert.equal(d.maxPositions,3);assert.equal(d.balances,s.balances);assert.equal(d.sharedPortfolio.activePositions,1);
 await assert.rejects(x.f.submit('ENTRY',{}, {slotBudgetUsdt:300}),/EXCEEDS_THIRD/);
 await x.manager.runLong(()=>x.orders.submit({side:'BUY',quoteOrderQty:'298.4'}));assert.equal(x.calls().spotCalls,1);
});

test('actual futures entry gate allows a third SHORT when no LONG uses its place',async()=>{
 const {FuturesShortRunner}=await import('../lib/futures-short-runner.mjs');
 const f={config:{enabled:true},state:{positions:{ETHUSDT:{algos:[],protectedAt:at},SOLUSDT:{algos:[],protectedAt:at}},pending:null},control:()=>({allowEntries:true}),permission:async()=>({enableFutures:true,ipRestrict:true}),now:()=>at,assertAccount:()=>{},snapshot:async()=>({}),submit:async()=>{},api:{get:async url=>url==='/fapi/v2/account'?futures():[]}};
 const manager=installSharedPortfolio({futuresShort:f,readSpot:async()=>({...spot(),balances:[]}),longManaged:()=>({}),spotOrders:{pending:null,submit:async()=>{}},maxLongUsdt:400,now:()=>at});
 await FuturesShortRunner.prototype.entryGate.call(f);
 f.state.positions.BTCUSDT={algos:[],protectedAt:at};await manager.refresh(true);
 await assert.rejects(FuturesShortRunner.prototype.entryGate.call(f),/SLOTS_FULL/);
});

test('manual amounts use available cash under the third while automatic allocation stays full-sized',()=>{
 const s=state();s.equityUsdt=381.58;s.grossSlotUsdt=127.19;s.futuresAvailableUsdt=86.17;s.spotAvailableUsdt=60;
 assert.equal(sharedAllocation(s,'SHORT',{now:at}).code,'SHARED_WALLET_FUNDS_REQUIRED');
 const a=sharedAllocation(s,'SHORT',{now:at,manual:true});assert.equal(a.ok,true);assert.equal(a.maxOrderUsdt,86.17);assert.equal(a.slotBudgetUsdt,127.19);assert.equal(a.missingUsdt,0);
 const b=sharedAllocation(s,'LONG',{now:at,manual:true});assert.equal(b.maxOrderUsdt,59.88);assert(b.maxOrderUsdt*1.002<=60);
 for(const side of ['LONG','SHORT']){
  assert.equal(sharedAllocation({...s,pending:true},side,{now:at,manual:true}).ok,false);
  assert.equal(sharedAllocation({...s,freeSlots:0},side,{now:at,manual:true}).ok,false);
  assert.equal(sharedAllocation(s,side,{now:at+15000,manual:true}).ok,false);
 }
});
test('manual entry gate and final submit accept 60 with 86.17 available; decline a later balance drop',async()=>{
 const {FuturesShortRunner}=await import('../lib/futures-short-runner.mjs');
 let available=86.17,posts=0;
 const f={config:{enabled:true},state:{positions:{},pending:null},control:()=>({allowEntries:true}),permission:async()=>({enableFutures:true,ipRestrict:true}),now:()=>at,assertAccount:()=>{},snapshot:async()=>({}),submit:async()=>{posts++;},api:{get:async url=>url==='/fapi/v2/account'?{...futures(),assets:[{asset:'USDT',walletBalance:'86.17',unrealizedProfit:'0',availableBalance:String(available)}]}:[]}};
 const manager=installSharedPortfolio({futuresShort:f,readSpot:async()=>({...spot(),totalValueUsdt:295.41,balances:[]}),longManaged:()=>({}),spotOrders:{pending:null,submit:async()=>{}},maxLongUsdt:400,now:()=>at});
 await assert.rejects(FuturesShortRunner.prototype.entryGate.call(f),/WALLET_FUNDS_REQUIRED/);
 await FuturesShortRunner.prototype.entryGate.call(f,60);
 await f.submit('ENTRY',{}, {slotBudgetUsdt:60});assert.equal(posts,1);
 available=59;await assert.rejects(f.submit('ENTRY',{}, {slotBudgetUsdt:60}),/EXCEEDS_THIRD/);assert.equal(posts,1);
 available=200;await manager.refresh(true);assert.throws(()=>f.assertAllocation(128),/EXCEEDS_THIRD/);
});
