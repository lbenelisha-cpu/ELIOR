import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function ui(){
 const elements=new Map();const context2d={scale(){},clearRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}};
 function el(id){if(!elements.has(id))elements.set(id,{value:id==='symbol'?'SPY':id==='capital'?'100000':'balanced',textContent:'',innerHTML:'',style:{},options:['SPY','QQQ','MSFT','AAPL'].map(value=>({value})),appendChild(o){this.options.push(o);},getBoundingClientRect(){return {width:500,height:270};},getContext(){return context2d;}});return elements.get(id);}
 const c=vm.createContext({document:{getElementById:el,createElement(){return {};}},window:{addEventListener(){}},Intl,Date,Number,Math,JSON,Set,Map,Array,Promise,String,console,devicePixelRatio:1,APP_CONFIG:{},setInterval(){},clearInterval(){},setTimeout,localStorage:{getItem(){return null;},setItem(){}},fetch:async()=>{throw Error('offline test')},alert(){},confirm(){return true;}});
 let script=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
 script=script.replace('syncCloud().catch(()=>{});startLive();loadScanner(false);','');
 vm.runInContext(script,c);return {c,el,run:(code)=>vm.runInContext(code,c),accept(data){c.fixture=data;vm.runInContext('acceptCloud(fixture)',c);}};
}
const quote={price:200,master:80,market:70,trend:80,risk:70,momentum:85,updated_at:'2026-09-16 15:30:00',signal:'מועמד לקנייה'};
const pos=(id,symbol,extra={})=>({id,symbol,start:100000,units:400,allocatedILS:80000,allocatedUSD:80000,entryFX:1,entryPrice:200,plan:'ai_dynamic',...extra});
const data=(positions,extra={})=>({portfolios:positions,snapshots:[],closed:[],account:{initialized:true,capital:100000,value:101000,cash:21000,pnl:1000,realized_pnl:1000,fx:1,marks:{MSFT:quote,SPY:{...quote,price:100}},updated_at:'2026-09-16T15:33:00Z'},accountSnapshots:[],...extra});
test('selected asset and active row follow rotation; top total preserves realized gains',()=>{
 const u=ui();u.accept(data([pos(1,'SPY')]));
 u.accept(data([pos(2,'MSFT',{predecessorId:'1'})],{rotation:{from_id:1,to_id:2,from_symbol:'SPY',to_symbol:'MSFT'},closed:[pos(1,'SPY',{closedAt:'2026-09-16T15:33:00Z',closedUnits:100,closedValue:10000,realizedPnl:1000})]}));
 assert.equal(u.el('symbol').value,'MSFT');assert.match(u.el('position').innerHTML,/MSFT/);assert.doesNotMatch(u.el('position').innerHTML,/SPY/);
 assert.match(u.el('closedPositions').innerHTML,/SPY/);assert.equal(u.el('price').textContent,'$200.00');assert.match(u.el('value').textContent,/101,000/);assert.equal(u.el('capital').readOnly,true);
});
test('account performance includes both symbols across rotation, independent of selection',()=>{
 const u=ui();const accountSnapshots=[{created_at:'2026-09-16T15:00:00Z',symbols:['SPY'],value:100000,pnl:0,fx:1,reason:'before'},{created_at:'2026-09-16T15:30:00Z',symbols:['MSFT'],value:101000,pnl:1000,fx:1,reason:'after'}];
 u.accept(data([pos(2,'MSFT')],{accountSnapshots}));
 assert.match(u.el('journal').innerHTML,/SPY/);assert.match(u.el('journal').innerHTML,/MSFT/);assert.match(u.el('performanceText').textContent,/התיק הכולל/);
 assert.match(u.el('snapCount').textContent,/2/);
});
test('multiple missed rotations follow predecessor chain without rewriting old histories',()=>{
 const u=ui();u.accept(data([pos(1,'SPY')]));
 u.accept(data([pos(3,'AAPL',{predecessorId:'2'})],{closed:[pos(1,'SPY',{closedAt:'2026-09-16T15:00:00Z'}),pos(2,'MSFT',{predecessorId:'1',closedAt:'2026-09-16T15:30:00Z'})],rotation:{from_id:2,to_id:3}}));
 assert.equal(u.el('symbol').value,'AAPL');assert.match(u.el('closedPositions').innerHTML,/MSFT/);assert.match(u.el('closedPositions').innerHTML,/SPY/);
});
test('screenshot regression: old cloud payload retains holdings, zero cash and the existing loss',()=>{
 const u=ui();const portfolios=[pos(1,'SPY',{units:100,allocatedILS:50000,allocatedUSD:50000,entryPrice:500,plan:'balanced'}),pos(2,'QQQ',{units:100,allocatedILS:50000,allocatedUSD:50000,entryPrice:500})];
 const snapshots=[{position_id:'1',symbol:'SPY',date:'2026-09-15',created_at:'2026-09-16T00:00:00Z',market_price:499.66,fx:1,position_value:49966,position_pnl:-34,score:53},{position_id:'2',symbol:'QQQ',date:'2026-09-15',created_at:'2026-09-16T00:00:00Z',market_price:494.21,fx:1,position_value:49421,position_pnl:-579,score:44}];
 u.accept({portfolios,snapshots});
 assert.match(u.el('value').textContent,/99,387/);assert.match(u.el('pnl').textContent,/613/);assert.doesNotMatch(u.el('cashValue').textContent,/100,000/);
 assert.equal(u.run('portfolioTotals().cash'),0);assert.equal(u.el('snapshot').disabled,true);assert.match(u.el('deploymentNotice').textContent,/Netlify Functions/);
 assert.match(u.el('journal').innerHTML,/SPY/);assert.match(u.el('snapCount').textContent,/1/);assert.match(u.el('performanceText').textContent,/היסטוריית הנכס/);
});
test('a legitimate zero realized PnL does not hide open positions before first account update',()=>{
 const u=ui();u.accept({portfolios:[pos(1,'SPY',{units:100,allocatedILS:50000,entryPrice:490})],snapshots:[],account:{initialized:false,capital:100000,realized_pnl:0},accountSnapshots:[]});
 assert.equal(u.run('portfolioTotals().cash'),50000);assert.equal(u.run('portfolioTotals().total'),99000);assert.match(u.el('accountUpdated').textContent,/מחירי כניסה/);
});
const modern=(positions,extra={})=>data(positions,{apiVersion:'6.2',capabilities:{automationSettings:true},...extra});
test('changing to a fixed plan keeps both automation controls selected and preserves unsaved draft during sync',()=>{
 const u=ui(),p=pos(1,'SPY',{autoRebalance:true,autoRotate:true});u.accept(modern([p]));
 assert.equal(u.el('autoRebalance').checked,true);assert.equal(u.el('autoRotate').checked,true);assert.equal(u.el('savePlan').disabled,false);
 u.el('programPlan').value='balanced';u.el('programPlan').onchange();u.el('autoRotate').checked=false;u.el('autoRotate').onchange();
 u.accept(modern([p]));assert.equal(u.el('programPlan').value,'balanced');assert.equal(u.el('autoRebalance').checked,true);assert.equal(u.el('autoRotate').checked,false);
 assert.match(u.el('automationHint').textContent,/50%/);assert.match(u.el('automationHint').textContent,/טרם נשמרו/);
});
test('saved settings apply independently per active program',()=>{
 const u=ui();const ps=[pos(1,'SPY',{plan:'balanced',autoRebalance:true,autoRotate:false}),pos(2,'QQQ',{plan:'growth',autoRebalance:false,autoRotate:true})];
 u.accept(modern(ps));assert.equal(u.el('autoRotate').checked,false);assert.equal(u.el('autoRebalance').checked,true);
 u.el('symbol').value='QQQ';u.run('setPlanUI()');assert.equal(u.el('programPlan').value,'growth');assert.equal(u.el('autoRotate').checked,true);assert.equal(u.el('autoRebalance').checked,false);
});
test('saving sends the selected plan and both boolean controls; server values are shown after save',async()=>{
 const u=ui();u.accept(modern([pos(1,'SPY',{autoRebalance:true,autoRotate:true})]));
 u.el('programPlan').value='conservative';u.el('programPlan').onchange();u.el('autoRotate').checked=false;u.el('autoRotate').onchange();
 u.c.savedResponse=modern([pos(1,'SPY',{plan:'conservative',autoRebalance:true,autoRotate:false})]);
 u.run("cloud=async(action,body)=>{globalThis.sent={action,body};return savedResponse;}");
 await u.run('saveSelectedPlan()');assert.equal(u.c.sent.action,'update_plan');assert.deepEqual(JSON.parse(JSON.stringify(u.c.sent.body)),{id:1,plan:'conservative',autoRebalance:true,autoRotate:false});
 assert.doesNotMatch(u.el('automationHint').textContent,/טרם נשמרו/);assert.match(u.el('plan').textContent,/שמרני/);assert.equal(u.el('autoRotate').checked,false);
});
test('old backend cannot silently accept settings it does not support',()=>{
 const u=ui();u.accept(data([pos(1,'SPY')]));assert.equal(u.el('savePlan').disabled,true);assert.equal(u.el('autoRotate').disabled,true);assert.match(u.el('deploymentNotice').textContent,/6.2/);
});

test('opening account balance is not plotted as a stock loss; journal is retained',()=>{
 const u=ui();u.accept(data([pos(1,'SPY')],{snapshots:[
 {symbol:'SPY',created_at:'2026-09-12T10:00:00Z',value:100000,pnl:0},
 {symbol:'SPY',position_id:'1',created_at:'2026-09-12T11:00:00Z',position_value:50000,position_pnl:0},
 {symbol:'SPY',position_id:'1',created_at:'2026-09-13T11:00:00Z',position_value:49500,position_pnl:-500}]}));
 assert.equal(u.run('legacyHistory().length'),2);assert.equal(u.run('snapshots().length'),3);
 assert.equal(u.run('legacyHistory()[0].value'),50000);
});
test('old monitor cannot report new agent success and budget wait is explicit',()=>{
 const u=ui();u.accept(data([pos(1,'SPY')],{monitor:{status:'ok',checked_at:new Date().toISOString(),note:'old agent'}}));
 assert.match(u.el('monitorStatus').textContent,/ממתין לסוכן המעודכן/);
 u.accept(data([pos(1,'SPY')],{monitor:{status:'waiting',checked_at:new Date().toISOString(),note:'V6.3 · wait'}}));
 assert.match(u.el('monitorStatus').textContent,/ממתין למכסת/);
});
