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
