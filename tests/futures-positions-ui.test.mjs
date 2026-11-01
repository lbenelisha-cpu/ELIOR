import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const code=fs.readFileSync(new URL('../binance-futures-positions.js',import.meta.url),'utf8');
const ctx=vm.createContext({});vm.runInContext(code,ctx);const view=ctx.LEVI_FUTURES_TABLE.view;
const now=Date.now();
const snapshot={mode:'live',shortTrading:{enabled:true,checkedAt:now,account:{walletUsdt:70,availableUsdt:36},positions:[{symbol:'ABCUSDT',qty:2,entryPrice:100,currentPrice:95,entryAt:now-600000,priceAt:now,targetPrice:90,stopPrice:99,protectedAt:now,algos:[{kind:'STOP_MARKET',status:'NEW'},{kind:'TAKE_PROFIT_MARKET',status:'NEW'}]}]}};
test('SHORT table calculates profit when price falls and shows independent wallet and count',()=>{
 const html=view(snapshot,now);assert.match(html,/1\/2/);assert.match(html,/>70</);assert.match(html,/>36</);assert.match(html,/\+10/);assert.match(html,/\+5%/);assert.match(html,/אומתו בבורסה/);
 const loss=structuredClone(snapshot);loss.shortTrading.positions[0].currentPrice=105;assert.match(view(loss,now),/-10/);assert.match(view(loss,now),/-5%/);
});
test('missing and stale prices are unknown instead of zero PnL; stale protection is not verified',()=>{
 const stale=view(snapshot,now+120000);assert.match(stale,/מחיר לא עדכני/);assert.doesNotMatch(stale,/\+10|\+5%|אומתו בבורסה/);assert.match(stale,/לא אומתו לאחרונה/);
 const missing=structuredClone(snapshot);missing.shortTrading.positions[0].currentPrice=null;assert.doesNotMatch(view(missing,now),/\+10|\+5%/);
});
test('unauthenticated and demo views never imply zero open positions; external text is escaped',()=>{
 assert.match(view({mode:'live',shortTrading:{enabled:true}},now),/יש לחבר מכשיר/);assert.doesNotMatch(view({mode:'live',shortTrading:{}},now),/0\/2/);
 assert.match(view({mode:'demo'},now),/עבור לתצוגת LIVE/);
 const x=structuredClone(snapshot);x.shortTrading.positions[0].symbol='<img onerror="bad">';assert.doesNotMatch(view(x,now),/<img/);assert.match(view(x,now),/&lt;img/);
});
test('agent fallback cannot erase mode data, expired auth clears it, and panel is visible in overview and portfolio',()=>{
 const panel={innerHTML:''},events={};const browser={document:{querySelector:()=>panel},setInterval(){},addEventListener:(n,f)=>events[n]=f};const c=vm.createContext({window:browser});vm.runInContext(code,c);
 browser.LEVI_FUTURES_TABLE.update(snapshot);const good=panel.innerHTML;browser.LEVI_FUTURES_TABLE.update({mode:'live'});assert.equal(panel.innerHTML,good);events['trade-device-expired']();assert.doesNotMatch(panel.innerHTML,/ABCUSDT/);
 const html=fs.readFileSync(new URL('../binance-agent.html',import.meta.url),'utf8');assert.match(html,/id="futuresPositionsPanel" class="panel app-view trade-view portfolio-view"/);assert.ok(html.indexOf('/binance-futures-positions.js')<html.indexOf('/binance-agent.js'));
});
