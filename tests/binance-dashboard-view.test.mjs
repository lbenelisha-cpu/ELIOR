import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as math from '../lib/binance-dashboard-math.mjs';
function ui(snapshot){
 const elements=new Map(),handlers={};
 function element(){return {children:[],hidden:false,textContent:'',dataset:{},value:'',style:{setProperty(){}},classList:{toggle(){}},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},setAttribute(k,v){this[k]=v;},addEventListener(){}};}
 const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 const window={LEVI_DASHBOARD_SNAPSHOT:snapshot,LEVI_MANUAL_TRADES:{connected:()=>true},addEventListener(name,fn){handlers[name]=fn;}};
 const context={...math,window,document:{hidden:false,getElementById:get,createElement:element,querySelector:()=>null},setInterval(){},Intl,Date};
 vm.runInNewContext(fs.readFileSync(new URL('../binance-dashboard.js',import.meta.url),'utf8').replace(/^import .*?;\n/,''),context);
 const text=n=>n.textContent+n.children.map(text).join('|');
 return {get,text:id=>text(get(id)),update:detail=>handlers['levi:binance-dashboard']({detail})};
}
function fixture(){
 const now=Date.now();return {mode:'live',receivedAt:now,account:{totalValueUsdt:100,usdtFree:0,maxPositions:5,balances:[{asset:'BTC',qty:2,entryPrice:50,usdtPrice:51,valueUsdt:100,pnlIls:2}]},agent:{config:{liveState:{ready:true,managedPositions:1,missingProtection:[],reconciliation:{checkedAt:new Date(now).toISOString()}}},agents:[{symbol:'BTCUSDT',strategy:{exitPolicy:'PROFIT_FLOOR4_TRAIL1PP_STOP1_V1',entryPrice:50,takeProfitPct:40,effectiveStopPrice:49,brokerProtection:{status:'ACTIVE',verifiedAt:now,stopPrice:49,takeProfitPrice:70}}}]}};
}
test('dashboard presents current wallet values and verified broker levels without treating zero cash as missing',()=>{
 const u=ui(fixture());assert.equal(u.text('overviewValue'),'100');assert.equal(u.text('overviewCash'),'0');assert.equal(u.text('overviewPnl'),'+2');assert.equal(u.text('overviewSlots'),'1 / 5');assert.equal(u.text('allocationPercent'),'0%');assert.match(u.text('positionMapContent'),/אומתו בבורסה/);assert.match(u.text('positionMapContent'),/70/);
});
test('failed or stale refresh removes financial values and green verification',()=>{
 const d=fixture(),u=ui(d);u.update({...d,error:true});assert.equal(u.text('overviewValue'),'—');assert.notEqual(u.get('overviewHealth').dataset.state,'good');assert.doesNotMatch(u.text('positionMapContent'),/אומתו בבורסה/);
 u.update({...d,receivedAt:Date.now()-61000});assert.equal(u.text('overviewCash'),'—');assert.equal(u.get('positionMapChart').hidden,true);
});
test('unmanaged holdings do not acquire illustrative stop and target levels',()=>{
 const d=fixture();d.agent.agents[0].strategy={};d.account.balances[0].pnlIls=null;
 const u=ui(d);assert.equal(u.text('overviewPnl'),'—');assert.match(u.text('positionMapContent'),/אין רמות הגנה להצגה/);assert.doesNotMatch(u.text('positionMapContent'),/אומתו בבורסה/);
});
test('a native standalone stop labels the profit target as server-managed',()=>{
 const d=fixture(),p=d.agent.agents[0].strategy.brokerProtection;p.mode='STOP_ONLY';p.takeProfitPrice=null;d.agent.config.liveState.softwareTargets=['BTCUSDT'];
 const u=ui(d);assert.match(u.text('positionMapContent'),/יעד במעקב השרת/);assert.match(u.text('positionMapContent'),/יעד הרווח תלוי בפעילות השרת/);assert.doesNotMatch(u.text('positionMapContent'),/מחירי ההגנה אומתו בבורסה/);
});

test('new trailing policy remains a managed holding with verified native protection',()=>{const d=fixture();d.agent.agents[0].strategy.exitPolicy='PROFIT_ACTIVATE5_TRAIL1PP_STOP1_V2';assert.match(ui(d).text('positionMapContent'),/אומתו בבורסה/);});
