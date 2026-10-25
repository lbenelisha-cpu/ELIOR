import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {DEFAULT_TRADE_SETTINGS,validateTradeSettings} from '../lib/trade-settings.mjs';
import {applyTrailingExitPolicy} from '../lib/trailing-profit-exit.mjs';
import {binancePositionExit} from '../lib/binance-position-exit.mjs';
import {nativeProtectionPlan} from '../lib/binance-native-protection.mjs';
import {planBuy} from '../lib/colmex-auto-policy.mjs';
import {makeSettingsHandler} from '../netlify/functions/colmex-settings.mjs';
import {powerHistory,POWER_INTERVALS} from '../lib/market-power-history.mjs';
import {analyzeCandlePower} from '../lib/candle-power.mjs';
const custom={takeProfitPct:20,stopLossPct:2,profitActivationPct:5,trailingGapPp:2};
test('settings defaults, numeric bounds, unknown fields and incompatible target are validated',()=>{
 assert.deepEqual(validateTradeSettings({}),DEFAULT_TRADE_SETTINGS);assert.deepEqual(validateTradeSettings(custom),custom);
 for(const x of [{takeProfitPct:'20'},{stopLossPct:0},{stopLossPct:99},{trailingGapPp:NaN},{anything:1},{takeProfitPct:3},{profitActivationPct:50}])assert.throws(()=>validateTradeSettings(x));
});
test('custom settings affect actual software exits, floor and native target, while existing floors never decrease',()=>{
 const p=applyTrailingExitPolicy({strategyId:'WYCKOFF_5M_V1',entryPrice:100,qty:2},custom);assert.equal(p.stopPrice,98);assert.equal(p.targetPrice,120);assert.equal(binancePositionExit(p,104).sell,false);assert.equal(binancePositionExit(p,105).sell,false);assert.equal(binancePositionExit(p,110).sell,false);assert.equal(p.effectiveStopPrice,108);assert.equal(binancePositionExit(p,108).sell,true);
 applyTrailingExitPolicy(p,{...custom,stopLossPct:10,trailingGapPp:10});assert.equal(p.effectiveStopPrice,108);
 const q=applyTrailingExitPolicy({strategyId:'WYCKOFF_5M_V1',entryPrice:100,qty:2},custom);assert.equal(binancePositionExit(q,120).sell,true);
});
function settingsRig({reject=false,locked=false}={}){
 const state={settingsRevision:0},events=[];let persisted;
 const handler=makeSettingsHandler({env:{COLMEX_AUTO_ACCOUNT_ID:'123'},storeFactory:()=>({get:async()=>({state})}),deviceStoreFactory:()=>({}),authorize:async(s,e,t)=>{events.push('AUTH');if(reject||t!=='Bearer mock')throw Object.assign(Error('DEVICE_REQUIRED'),{status:401});},leaseFactory:async()=>{events.push('LOCK');if(locked)return null;return {state,save:async s=>{persisted=structuredClone(s);events.push('SAVE')},release:async()=>events.push('RELEASE')};}});
 const context={deploy:{context:'production'}};
 const request=(body,token='Bearer mock')=>handler(new Request('https://example.com/.netlify/functions/colmex-settings',{method:'POST',headers:{Origin:'https://example.com',Authorization:token,'Content-Type':'application/json'},body:JSON.stringify(body)}),context);
 return {request,handler,context,state,events,get persisted(){return persisted}};
}
test('Colmex settings require device authorization, serialize against trading and persist revision',async()=>{
 const r=settingsRig();assert.equal((await r.request({revision:0,values:custom})).status,200);assert.deepEqual(r.persisted.settings,custom);assert.equal(r.persisted.settingsRevision,1);assert.deepEqual(r.events,['AUTH','LOCK','SAVE','RELEASE']);
 assert.equal((await r.request({revision:0,values:custom})).status,409);
 const forbidden=settingsRig({reject:true});assert.equal((await forbidden.request({revision:0,values:custom})).status,401);assert.equal(forbidden.persisted,undefined);
 assert.equal((await settingsRig({locked:true}).request({revision:0,values:custom})).status,409);
});
test('settings GET is read-only; invalid settings never acquire lease or send broker orders',async()=>{
 const r=settingsRig();const response=await r.handler(new Request('https://example.com/.netlify/functions/colmex-settings'),r.context);assert.deepEqual((await response.json()).values,DEFAULT_TRADE_SETTINGS);assert.deepEqual(r.events,[]);
 assert.equal((await r.request({revision:0,values:{takeProfitPct:-5}})).status,400);assert.deepEqual(r.events,['AUTH']);
});
test('Binance settings route is authenticated and persists before replacing active configuration',()=>{
 const s=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');assert.match(s,/protectedControl=\(privateRead&&!notificationRead\)\|\|req.method==='POST'[\s\S]*u.pathname==='\/api\/binance-settings'/);
 const a=s.indexOf("if(u.pathname==='/api/binance-settings')"),b=s.indexOf("if(u.pathname==='/api/binance-market-power'",a),route=s.slice(a,b);assert.ok(route.indexOf('renameSync')<route.indexOf('tradeSettings=next'));assert.match(route,/input.revision!==tradeSettings.revision/);
});
test('hour/day/week/month market power excludes forming candles and sorts broker history',()=>{
 const now=Date.UTC(2026,9,24),b=t=>({t,o:100,h:110,l:95,c:105,v:50});
 for(const interval of Object.keys(POWER_INTERVALS)){const old=interval==='1M'?Date.UTC(2026,7,1):now-30*86400000,rows=powerHistory({barDetails:[b(now),b(old)]},interval,now);assert.equal(rows.length,1);assert.equal(analyzeCandlePower(rows).buyerCandles,1);}
 assert.throws(()=>powerHistory({barDetails:[b(1),b(1)]},'1d',now));assert.throws(()=>powerHistory({barDetails:[{...b(1),h:50}]},'1d',now));
});
test('chart risk table uses saved per-position values instead of fixed 50/1/4',()=>{
 const c={};vm.runInNewContext(fs.readFileSync(new URL('../trade-risk.js',import.meta.url),'utf8'),c);const p=applyTrailingExitPolicy({entryPrice:100,qty:2},custom),r=c.LEVI_TRADE_RISK.levels(p);assert.equal(r.brokerTarget,120);assert.equal(r.stop,98);assert.equal(r.target,105);assert.equal(r.gap,2);
});
test('Colmex new orders receive configured native bracket percentages anchored to execution',()=>{
 const now=Date.parse('2026-10-20T15:00:00Z'),sizes=[{leftRangeLimit:0,tickSize:.01}];
 const result=planBuy({settings:custom,instrument:{tradableInstrumentId:1,type:'EQUITY'},details:{quotingCurrency:'USD',symbolStatus:'FULLY_OPEN',tickSize:sizes,lotStep:1,lotSize:1,minLot:1,maxLot:1000},quote:{ap:100,bp:99.99},positions:[],orders:[],cash:1000,now,receivedAt:now});
 assert.equal(result.reason,'READY');assert.equal(result.order.stopLoss,2);assert.equal(result.order.takeProfit,20);assert.equal(result.order.takeProfitType,'offset%');
});
test('native Binance target is computed from configured position values',()=>{
 const p=applyTrailingExitPolicy({entryPrice:100,qty:2},custom),info={symbol:'ABCUSDT',status:'TRADING',ocoAllowed:true,orderTypes:['TAKE_PROFIT','STOP_LOSS'],filters:[{filterType:'LOT_SIZE',stepSize:'.01',minQty:'.01',maxQty:'10000'},{filterType:'PRICE_FILTER',tickSize:'.01',minPrice:'.01',maxPrice:'10000'}]};
 const plan=nativeProtectionPlan('ABCUSDT',p,100,info,2);assert.equal(plan.params.aboveStopPrice,'120');assert.equal(plan.params.belowStopPrice,'98');
});
