import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const src=fs.readFileSync(new URL('../binance-agent.js',import.meta.url),'utf8');
const ctx=vm.createContext({});vm.runInContext(src.slice(src.indexOf('function liveEntryStatus('),src.indexOf('function renderMarketStrip(')),ctx);
const agent={entryConfirmed:true,entryEligible:true,strategy:{buyConfirmed:true},blocker:{code:'BUY_READY',text:'וויקוף אושר'}};
const account={connected:true,tradingGate:{ready:true,withdrawalsEnabled:false},fixedPositionUsdt:28.72583,usdtFree:23.81606844,balances:['BNB','ZEC','UNI','QQQB'].map(asset=>({asset,valueUsdt:28}))};
test('a free fifth slot cannot advertise readiness when fixed allocation exceeds actual cash',()=>{
 const status=ctx.liveEntryStatus(agent,account,5);assert.equal(status.decision,'WAIT_CASH');assert.equal(status.blocker.code,'NO_CASH');assert.match(status.blocker.text,/23\.82/);assert.match(status.blocker.text,/28\.78/);assert.match(status.blocker.text,/4\.97/);
 assert.equal(ctx.decisionFor({...agent,position:'LONG'},false,4,5,null,20,true,account),'WAIT_CASH');
});
test('the same fee reserve boundary used by execution determines readiness without resizing the trade',()=>{
 const required=28.72583*1.002;assert.equal(ctx.liveEntryStatus(agent,{...account,usdtFree:required-.000001},5).decision,'WAIT_CASH');
 assert.equal(ctx.liveEntryStatus(agent,{...account,usdtFree:required},5).decision,'BUY_READY');assert.equal(account.fixedPositionUsdt,28.72583);
});
test('unknown account, disabled permissions and full wallet cannot become green buy alerts',()=>{
 assert.equal(ctx.liveEntryStatus(agent,null,5).decision,'WAIT_ACCOUNT');
 assert.equal(ctx.liveEntryStatus(agent,{...account,tradingGate:{ready:false}},5).decision,'WAIT_LIVE_GATE');
 assert.equal(ctx.liveEntryStatus(agent,{...account,usdtFree:100,balances:[...account.balances,{asset:'SUI',valueUsdt:28}]},5).decision,'WAIT_NO_SLOT');
});
test('unconfirmed or expired analysis cannot bypass entry eligibility; real holdings remain holdings',()=>{
 assert.equal(ctx.liveEntryStatus({...agent,entryConfirmed:false},{...account,usdtFree:100},5).decision,'HOLD');
 assert.equal(ctx.liveEntryStatus({...agent,entryEligible:false},{...account,usdtFree:100},5).decision,'HOLD');
 assert.equal(ctx.decisionFor(agent,true,4,5,null,20,true,account),'HOLD');
 assert.equal(ctx.decisionFor({...agent,decision:'BUY_READY'},false,0,5,null,20,false,account),'BUY_READY');
});
test('stablecoin cash and dust do not consume position slots',()=>{
 assert.equal(ctx.liveEntryStatus(agent,{...account,usdtFree:100,balances:[...account.balances,{asset:'USDC',valueUsdt:100},{asset:'SOL',valueUsdt:.08}]},5).decision,'BUY_READY');
});
test('the server-authorized last-slot remainder is ready even below the regular allocation',()=>{
 const nextBuyAllocation={ok:true,lastSlot:true,amountUsdt:23.76853137,code:'BUY_ALLOCATION_READY'};
 const status=ctx.liveEntryStatus(agent,{...account,nextBuyAllocation},5);assert.equal(status.decision,'BUY_READY');assert.match(status.blocker.text,/23\.77/);assert.match(status.blocker.text,/פוזיציה אחרונה/);
});
