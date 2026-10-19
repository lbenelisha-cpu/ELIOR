import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
function auth(storage=new Map()){
 const context=vm.createContext({window:{},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});
 vm.runInContext(read('binance-control-session.js'),context);return context.window.LEVI_TRADE_AUTH;
}
test('device authorization survives reload and forgetting removes it',()=>{
 const storage=new Map(),first=auth(storage),token='x'.repeat(40);
 assert.equal(first.read(),null);first.remember(token);assert.equal(auth(storage).read(),token);
 first.clear();assert.equal(auth(storage).read(),null);
});
test('storage denial falls back to current-page authorization',()=>{
 const c=vm.createContext({window:{},localStorage:{getItem(){throw Error();},setItem(){throw Error();},removeItem(){throw Error();}}});vm.runInContext(read('binance-control-session.js'),c);const a=c.window.LEVI_TRADE_AUTH;assert.equal(a.remember('x'.repeat(40)),false);assert.equal(a.read().length,40);a.clear();assert.equal(a.read(),null);
});
test('saved authentication bypasses prompts and 401 clears it without retrying the order',async()=>{
 const a=auth();a.remember('x'.repeat(40));let calls=0,prompts=0,fail=false;
 const c=vm.createContext({window:{LEVI_TRADE_AUTH:a},prompt:()=>{prompts++;return null;},J:async()=>{calls++;if(fail)throw Error('401');return {ok:true};}});
 vm.runInContext('let tradeControlToken=window.LEVI_TRADE_AUTH.read();'+read('binance-agent.js').split('async function authenticatedControl(')[1].split('async function setMode(')[0].replace(/^/, 'async function authenticatedControl('),c);
 await c.authenticatedControl('/manual',{});assert.equal(prompts,0);assert.equal(calls,1);
 fail=true;await assert.rejects(()=>c.authenticatedControl('/manual',{}),/חיבור המכשיר אינו תקף/);assert.equal(a.read(),null);assert.equal(calls,2);
});
function ui(){
 const elements=new Map();const get=id=>{if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,value:'',textContent:'',open:false,focus(){},showModal(){this.open=true;},close(){this.open=false;},addEventListener(){}});return elements.get(id);};
 const calls=[];let resolve,refreshes=0;const state={mode:'live',symbol:'BNBUSDT',capabilities:{version:1,maxOrderUsdt:400,maxPositions:5},account:{usdtFree:100,balances:[{asset:'BNB',free:.03886}]}};
 const c=vm.createContext({document:{getElementById:get},window:{LEVI_MANUAL_TRADES:{context:()=>state,submit:async input=>{calls.push({...input});return new Promise(r=>resolve=r);},refresh:async()=>refreshes++,forget(){}}},crypto:{randomUUID:()=>Math.random().toString().repeat(2)},setInterval(){}});
 vm.runInContext(read('binance-manual-trades.js'),c);return {get,calls,state,resolve:r=>resolve(r),get refreshes(){return refreshes;}};
}
test('sell click submits full balance immediately, double click never submits twice, uncertainty only checks same identity',async()=>{
 const h=ui();h.get('manualSellBtn').onclick();h.get('manualSellBtn').onclick();assert.equal(h.calls.length,1);assert.equal(h.calls[0].side,'SELL');assert.equal(h.calls[0].all,true);assert.equal(h.get('manualTradeSubmit').hidden,true);
 const id=h.calls[0].requestId;h.resolve({ok:false,uncertain:true,error:'unknown'});await new Promise(r=>setImmediate(r));assert.equal(h.get('manualTradeCheck').hidden,false);
 h.get('manualBuyBtn').onclick();assert.equal(h.calls.length,1);
 const check=h.get('manualTradeCheck').onclick();assert.equal(h.calls.length,2);assert.equal(h.calls[1].requestId,id);assert.equal(h.calls[1].statusOnly,true);
 h.resolve({ok:true,order:{status:'FILLED',executedQty:.038,orderId:1}});await check;assert.equal(h.refreshes,1);
});
test('buy requires only an amount and buy button, and honors symbol changes',async()=>{
 const h=ui();h.get('manualBuyBtn').onclick();assert.equal(h.calls.length,0);assert.equal(h.get('manualTradeSubmit').textContent,'קנה');
 h.get('manualQuoteAmount').value='10';const buy=h.get('manualTradeSubmit').onclick();assert.equal(h.calls.length,1);assert.equal(h.calls[0].quoteUsdt,10);h.resolve({ok:true,order:{status:'FILLED',executedQty:1,orderId:2}});await buy;
 const other=ui();other.get('manualBuyBtn').onclick();other.state.symbol='UNIUSDT';other.get('manualQuoteAmount').value='10';await other.get('manualTradeSubmit').onclick();assert.equal(other.calls.length,0);
});
