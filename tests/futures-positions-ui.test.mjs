import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const code=fs.readFileSync(new URL('../binance-futures-positions.js',import.meta.url),'utf8');
const ctx=vm.createContext({});vm.runInContext(code,ctx);const view=ctx.LEVI_FUTURES_TABLE.view;
const now=Date.now();
const snapshot={mode:'live',shortTrading:{enabled:true,checkedAt:now,account:{walletUsdt:70,availableUsdt:36},positions:[{symbol:'ABCUSDT',qty:2,entryPrice:100,currentPrice:95,entryAt:now-600000,priceAt:now,targetPrice:90,stopPrice:99,protectedAt:now,algos:[{kind:'STOP_MARKET',status:'NEW'},{kind:'TAKE_PROFIT_MARKET',status:'NEW'}]}]}};
test('shared watch shows missing contracts and paused execution without hiding technical checks',()=>{
 const data=structuredClone(snapshot);data.shortTrading.watch={policy:{version:'SHARED_LONG_SHORT_WATCH_V1'},checkedAt:now,entryBlocker:'FUTURES_TWO_SLOTS_FULL',rows:[{spotSymbol:'GOOGLBUSDT',futuresSymbol:'GOOGLUSDT',available:true,at:now,expiresAt:now+60000,reason:'SHORT_VOLUME_LOW'},{spotSymbol:'NVDABUSDT',available:false,at:null,mappingReason:'FUTURES_SYMBOL_UNAVAILABLE'}]};
 const html=view(data,now);assert.match(html,/GOOGLBUSDT/);assert.match(html,/GOOGLUSDT/);assert.match(html,/שני מקומות השורט תפוסים/);assert.match(html,/מחזור הפריצה קטן/);assert.match(html,/אין חוזה USDT תואם/);
 assert.match(view(data,now+100000),/סריקת SHORT התיישנה/);
});
test('SHORT consolidation rules wait for the runtime marker and scan reasons show recorded evidence',()=>{
 assert.doesNotMatch(view(snapshot,now),/דשדוש לפני הכניסה/);
 const data=structuredClone(snapshot);data.shortTrading.policy={consolidationPolicy:{version:'CHANNEL_CONSOLIDATION_V1'}};
 data.shortTrading.checks={XYZUSDT:{at:now,reason:'CHANNEL_CONSOLIDATION_SIDE_BLOCK',consolidation:{zone:'LOWER',bars:4,endAt:now-300000}}};
 const html=view(data,now);assert.match(html,/אמצעי מאפשר את שני הכיוונים/);assert.match(html,/מיקום הדשדוש אינו מתאים/);assert.match(html,/דשדוש תחתון · 4 נרות/);
});
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

test('SHORT exposes scan reasons and recorded closures without fabricating realized profit',()=>{
 const x=structuredClone(snapshot);x.shortTrading.checks={'<bad>':{at:now-120000,reason:'WAIT_TWO_TOUCHES_PER_SIDE'}};
 x.shortTrading.closed=[{symbol:'ABCUSDT',entryAt:now-600000,closedAt:now,entryPrice:100,reason:'BROKER_OR_EXTERNAL_CLOSE'}];
 const html=view(x,now);assert.match(html,/נתון קודם/);assert.match(html,/ממתין לתעלה עם שתי נגיעות/);assert.match(html,/&lt;bad&gt;/);assert.doesNotMatch(html,/<bad>/);assert.match(html,/סגירות SHORT אחרונות · 1/);assert.match(html,/רווח ממומש אינם כלולים/);assert.match(html,/סגירה בבורסה או ממקור חיצוני/);
});

test('SHORT displays the settings policy only after the server reports it',()=>{
 const x=structuredClone(snapshot);assert.match(view(x,now),/יעד הרווח לפי התעלה/);
 x.shortTrading.policy={exitPolicy:'FUTURES_SHORT_SETTINGS_V2'};
 x.shortTrading.closed=[{symbol:'ABCUSDT',entryAt:now-1000,closedAt:now,entryPrice:100,reason:'SETTINGS_TAKE_PROFIT'}];
 const html=view(x,now);assert.match(html,/יעד התעלה אינו סוגר SHORT/);assert.match(html,/יעד רווח לפי הגדרות האפליקציה/);
});
