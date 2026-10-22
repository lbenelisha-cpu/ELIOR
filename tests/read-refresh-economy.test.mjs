import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('dashboard schedules 30s reads and makes no scheduled or visibility reads while hidden',()=>{
 const source=read('binance-agent.js'),start=source.lastIndexOf('load();\nsetInterval('),end=source.indexOf('// Keep account detail',start);assert.ok(start>=0&&end>start);
 const callbacks={},doc={hidden:false,addEventListener:(name,cb)=>callbacks[name]=cb};let calls=0,tick,period;
 vm.runInNewContext(source.slice(start,end),{document:doc,load:()=>calls++,setInterval:(cb,ms)=>{tick=cb;period=ms;}});
 assert.equal(period,30000);assert.equal(calls,1);doc.hidden=true;tick();callbacks.visibilitychange();assert.equal(calls,1);doc.hidden=false;callbacks.visibilitychange();assert.equal(calls,2);tick();assert.equal(calls,3);
});
test('portfolio consumes dashboard events without a second HTTP request or independent poller',()=>{
 const callbacks={},body={innerHTML:''},window={addEventListener:(name,cb)=>callbacks[name]=cb};
 const context={window,document:{querySelector:()=>body},fetch:()=>assert.fail('duplicate request'),setInterval:()=>assert.fail('duplicate poller')};vm.runInNewContext(read('binance-agent-portfolio.js'),context);
 callbacks['levi:binance-agent']({detail:{paper:{positions:{BTCUSDT:{pnlIls:1,pnlPct:2,entryPrice:50,currentPrice:51}}}}});assert.match(body.innerHTML,/BTCUSDT/);assert.match(body.innerHTML,/pnl-profit/);
 callbacks['levi:binance-agent']({detail:{paper:{positions:{}}}});assert.match(body.innerHTML,/אין פוזיציות/);
});
test('collapsed demo balances do not fetch; opening loads once and hidden refreshes remain passive',async()=>{
 const events={},buttonEvents={},nodes={demoBalanceDetails:{hidden:true},demoAccountStatus:{},demoAccountTotal:{},demoAccountBalances:{replaceChildren(){}}};let reads=0,tick;
 const document={hidden:false,getElementById:id=>nodes[id]||{addEventListener(){}},querySelector:()=>({addEventListener:(name,cb)=>buttonEvents[name]=cb}),addEventListener:(name,cb)=>events[name]=cb};
 vm.runInNewContext(read('binance-demo-account.js'),{window:{API_BASE:'https://example.test',binanceReadUrl:u=>u},document,setInterval:cb=>tick=cb,fetch:async()=>{reads++;return {ok:false,json:async()=>({error:'test'})}}});
 assert.equal(reads,0);await tick();assert.equal(reads,0);nodes.demoBalanceDetails.hidden=false;await buttonEvents.click();assert.equal(reads,1);document.hidden=true;await tick();assert.equal(reads,1);document.hidden=false;await events.visibilitychange();assert.equal(reads,2);
});
