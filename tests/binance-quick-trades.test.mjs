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
 vm.runInContext(read('binance-manual-trades.js'),c);return {get,calls,state,quick:c.window.LEVI_QUICK_TRADE,resolve:r=>resolve(r),get refreshes(){return refreshes;}};
}
test('sell requires final confirmation, double click never submits twice, uncertainty only checks same identity',async()=>{
 const h=ui();h.get('manualSellBtn').onclick();h.get('manualSellBtn').onclick();assert.equal(h.calls.length,0);h.get('manualTradeSubmit').onclick();h.get('manualTradeSubmit').onclick();assert.equal(h.calls.length,1);assert.equal(h.calls[0].side,'SELL');assert.equal(h.calls[0].all,true);assert.equal(h.get('manualTradeSubmit').disabled,true);
 const id=h.calls[0].requestId;h.resolve({ok:false,uncertain:true,error:'unknown'});await new Promise(r=>setImmediate(r));assert.equal(h.get('manualTradeCheck').hidden,false);
 h.get('manualBuyBtn').onclick();assert.equal(h.calls.length,1);
 const check=h.get('manualTradeCheck').onclick();assert.equal(h.calls.length,2);assert.equal(h.calls[1].requestId,id);assert.equal(h.calls[1].statusOnly,true);
 h.resolve({ok:true,order:{status:'FILLED',executedQty:.038,orderId:1}});await check;assert.equal(h.refreshes,1);
});
test('buy requires only an amount and buy button, and honors symbol changes',async()=>{
 const h=ui();h.get('manualBuyBtn').onclick();assert.equal(h.calls.length,0);assert.equal(h.get('manualTradeSubmit').textContent,'אני מאשר קנייה בכסף אמיתי');
 h.get('manualQuoteAmount').value='10';const buy=h.get('manualTradeSubmit').onclick();assert.equal(h.calls.length,1);assert.equal(h.calls[0].quoteUsdt,10);h.resolve({ok:true,order:{status:'FILLED',executedQty:1,orderId:2}});await buy;
 const other=ui();other.get('manualBuyBtn').onclick();other.state.symbol='UNIUSDT';other.get('manualQuoteAmount').value='10';await other.get('manualTradeSubmit').onclick();assert.equal(other.calls.length,0);
});

test('row quick action freezes its own asset and Futures action uses explicit short intent',async()=>{
 const h=ui();h.quick('BUY','ETHUSDT','SPOT');assert.match(h.get('manualTradeTitle').textContent,/ETHUSDT/);assert.equal(h.calls.length,0);
 h.get('manualQuoteAmount').value='10';const sent=h.get('manualTradeSubmit').onclick();assert.equal(h.calls[0].symbol,'ETHUSDT');h.resolve({ok:true,order:{status:'FILLED',executedQty:1}});await sent;
 const f=ui();f.state.futuresCapabilities={version:1,maxOrderUsdt:35};f.state.futures={positions:[{symbol:'HYPEUSDT'}],account:{availableBalance:50}};
 f.quick('SELL','HYPEUSDT','FUTURES');assert.match(f.get('manualTradeTitle').textContent,/סגירת שורט/);assert.equal(f.calls.length,0);
 const close=f.get('manualTradeSubmit').onclick();assert.equal(f.calls[0].side,'CLOSE_SHORT');assert.equal(f.calls[0].market,'FUTURES');assert.equal(f.calls[0].symbol,'HYPEUSDT');assert.equal(f.calls[0].all,true);
 f.resolve({ok:true,order:{status:'FILLED',executedQty:.43}});await close;
});

test('SHORT modal shows dynamic allocation above 35 and rechecks reduced capability before sending',async()=>{
 const h=ui();h.state.futuresCapabilities={version:1,maxOrderUsdt:100,maxPositions:2};h.state.futures={positions:[],account:{availableUsdt:200}};
 h.quick('BUY','BTCUSDT','FUTURES');assert.equal(h.get('manualQuoteAmount').value,'100');assert.match(h.get('manualTradeSummary').textContent,/100/);assert.doesNotMatch(h.get('manualTradeSummary').textContent,/35 USDT/);assert.equal(h.calls.length,0);
 h.state.futuresCapabilities.maxOrderUsdt=40;await h.get('manualTradeSubmit').onclick();assert.equal(h.calls.length,0);
 h.get('manualQuoteAmount').value='40';const sent=h.get('manualTradeSubmit').onclick();assert.equal(h.calls[0].quoteUsdt,40);assert.equal(h.calls[0].side,'OPEN_SHORT');
 h.resolve({ok:false,error:'FUTURES_MIN_NOTIONAL_OR_QUANTITY'});await sent;assert.match(h.get('manualTradeResult').textContent,/מינימום/);
});
