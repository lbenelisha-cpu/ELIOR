import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {retainDecision} from '../lib/decision-chart-history.mjs';
const ctx=vm.createContext({Date});
vm.runInContext(fs.readFileSync(new URL('../binance-chart-decisions.js',import.meta.url),'utf8'),ctx);
const at='2026-10-10T12:00:00Z',time=Date.parse(at);
test('repeated checks retain timestamps/count; changed blockers and modes remain distinct',()=>{
 const row={at,mode:'demo',decision:'HOLD',buyReason:'TRADING_PAUSED'};
 let rows=retainDecision([],row);
 rows=retainDecision(rows,{...row,at:'2026-10-10T12:00:05Z'});
 assert.equal(rows.length,1);assert.equal(rows[0].checks,2);assert.equal(rows[0].firstAt,at);
 rows=retainDecision(rows,{...row,buyReason:'SPRING'});assert.equal(rows.length,2);
 rows=retainDecision(rows,{...row,mode:'live'});assert.equal(rows.length,3);
});
test('only true signals are green; failures and actual fills remain distinct',()=>{
 assert.equal(ctx.chartDecisionKind({analysisSignal:true,buyReason:'TRADING_PAUSED'}),'signal');
 assert.equal(ctx.chartDecisionKind({decision:'BUY_READY',analysisSignal:false}),'wait');
 assert.equal(ctx.chartDecisionKind({analysisError:'WAIT_FRESH_PRICE'}),'error');
 assert.equal(ctx.chartDecisionKind({type:'BUY'}),'fill');
});
test('groups share a candle, retain all details and exclude rows outside the chart',()=>{
 const candles=[{openTime:time-3600000,closeTime:time+3600000}];
 const groups=ctx.groupChartDecisions(candles,[{at,checks:5},{at,checks:2},{at:new Date(time+7200000).toISOString()},{at,type:'BUY'}]);
 assert.equal(groups.length,2);assert.equal(groups[0].checks,7);assert.equal(groups[0].rows.length,2);
});
test('future returns use only closed bars after the horizon; missing data stays pending',()=>{
 const row={at,price:100},day=86400000;
 const candles=[{closeTime:time+day-1,close:90},{closeTime:time+day+1000,close:110}];
 assert.equal(ctx.chartSignalReturn(row,candles,1,time+day),null);
 assert.ok(Math.abs(ctx.chartSignalReturn(row,candles,1,time+2*day)-10)<1e-10);
 assert.equal(ctx.chartSignalReturn(row,candles,7,time+10*day),null);
 assert.equal(ctx.chartSignalReturn(row,[{closeTime:time+10*day,close:120}],1,time+11*day),null);
});
test('pivot overlay selects the latest confirmed stored setup and never guesses legacy points',()=>{
 const setup={initialPeak:{price:12,time:time-600000},springLow:{price:9,time:time-300000},confirmation:{price:11,time}};
 assert.equal(ctx.latestWyckoffSetup([{at,analysisSignal:false,setup}]),null);
 assert.equal(ctx.latestWyckoffSetup([{at,type:'BUY',wyckoffTrade:{initialPeak:12,springLow:9}}]),null);
 const found=ctx.latestWyckoffSetup([{at,type:'BUY',wyckoffTrade:{setup}}]);assert.equal(found.confirmation.time,time);assert.equal(found.initialPeak.price,12);
});

test('Binance high captions use the upper edge, lows use the lower edge and arrows retain exact anchors',()=>{
 class Element{constructor(){this.children=[];this.dataset={};this.style={setProperty(){}};this.clientWidth=850;this.clientHeight=560;}append(x){this.children.push(x);}replaceChildren(){this.children=[];}setAttribute(k,v){this[k]=v;}}
 const root=new Element(),setup=Object.fromEntries(['initialPeak','firstLow','rallyHigh','secondaryTest','springLow','confirmation'].map((key,i)=>[key,{time:time+i*300000,price:100+i}]));
 const view=Array.from({length:6},(_,i)=>({openTime:time-1+i*300000,closeTime:time+299999+i*300000}));
 const scope=vm.createContext({Date,document:{querySelector:()=>root,createElement:()=>new Element()},currentAgentData:{agents:[]},selectedSymbol:'BTCUSDT',fmt:String});
 vm.runInContext(fs.readFileSync(new URL('../binance-chart-decisions.js',import.meta.url),'utf8'),scope);
 scope.renderWyckoffPivots(view,[{at,analysisSignal:true,setup}],100,18,p=>300-p,4);
 const labels=root.children.filter(e=>e.className==='wyckoff-pivot'),arrows=root.children.filter(e=>e.className?.startsWith('wyckoff-arrow '));
 assert.equal(labels.length,6);assert.equal(arrows.length,6);
 for(const label of labels)assert.equal(label.style.top,['initialPeak','rallyHigh'].includes(label.dataset.pivot)?'66px':'533px');
 assert.equal(arrows[0].style.left,'68px');assert.equal(arrows[0].style.top,'200px');assert.equal(arrows[0].className,'wyckoff-arrow points-down');assert.equal(arrows[1].className,'wyckoff-arrow points-up');
});
