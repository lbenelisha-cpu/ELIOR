import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
function fixture(read,now=()=>1800000000000){const nodes=[];const element=tag=>{const n={tag,children:[],textContent:'',hidden:false,value:'',events:{},append(...xs){this.children.push(...xs);},replaceChildren(...xs){this.children=xs;},setAttribute(k,v){this[k]=v;},addEventListener(k,fn){this.events[k]=fn;}};nodes.push(n);return n;};const context=vm.createContext({document:{createElement:element,createElementNS:(ns,tag)=>element(tag)},Date,Intl,Number,Error});vm.runInContext(fs.readFileSync(new URL('../binance-equity-history.js',import.meta.url),'utf8').split("const host=document.getElementById('binanceEquityPanel');")[0].replaceAll('export function','function'),context);const host=element('section'),panel=context.createEquityPanel(host,{read,now});const text=n=>n.textContent+n.children.map(text).join('|');return {panel,nodes,context,text:()=>text(host)};}
const response={ok:true,points:[{at:1800000000000,valueUsdt:140,unpricedAssets:[]}],summary:{currentUsdt:140,firstUsdt:140,firstAt:1800000000000,lastAt:1800000000000,changeUsdt:0,changePct:0,lowUsdt:140,highUsdt:140,count:1},unpricedAssets:[],stale:false,storageError:false};const turn=()=>new Promise(r=>setImmediate(r));
test('single sample is explicit; zero is rendered as value and a stale reading is not called current',async()=>{const u=fixture(async()=>({...response,stale:true,summary:{...response.summary,currentUsdt:0}}));u.panel.setContext({mode:'live'});await turn();assert.match(u.text(),/נקודה ראשונה/);assert.match(u.text(),/שווי אחרון שנמדד/);assert.match(u.text(),/0.00 USDT/);assert.doesNotMatch(u.text(),/שווי התיק כעת/);});
test('disconnect cancels in-flight private response; errors clear previous figures and retry is bounded',async()=>{let resolve;const u=fixture(()=>new Promise(r=>resolve=r));u.panel.setContext({mode:'live'});u.panel.setContext({mode:'live',unauthorized:true});resolve(response);await turn();assert.doesNotMatch(u.text(),/140.00/);let calls=0;const v=fixture(async()=>{if(calls++)throw Error('unavailable');return response;});v.panel.setContext({mode:'live'});await turn();await v.panel.load(true);assert.doesNotMatch(v.text(),/140.00/);v.panel.tick();assert.equal(calls,2);});
test('chart does not join across incomplete values or prolonged gaps',()=>{const {context}=fixture(()=>{});const groups=context.equitySegments([{at:1,valueUsdt:100},{at:60001,valueUsdt:110},{at:120001,valueUsdt:null},{at:180001,valueUsdt:90},{at:400001,valueUsdt:95}]);assert.deepEqual(Array.from(groups,g=>g.length),[2,1,1]);});

const choose=(u,label)=>u.nodes.find(n=>n.tag==='button'&&n.textContent===label).events.click();
const futures={...response,market:'FUTURES',source:'BINANCE_FUTURES_USDT_ACCOUNT_SNAPSHOTS',
 points:[{at:1800000000000,valueUsdt:45}],summary:{...response.summary,currentUsdt:45,firstUsdt:45,highUsdt:45,lowUsdt:45}};

test('the same chart switches accounts, partitions refreshes, and cannot display a late Spot response under Futures',async()=>{
 const pending={},calls=[];
 const u=fixture(market=>{calls.push(market);return new Promise(resolve=>pending[market]=resolve);});
 u.panel.setContext({mode:'live'});choose(u,'SHORT · Futures');assert.deepEqual(calls,['SPOT','FUTURES']);
 pending.FUTURES(futures);await turn();assert.match(u.text(),/45.00 USDT/);
 pending.SPOT(response);await turn();assert.doesNotMatch(u.text(),/140.00 USDT/);
 choose(u,'LONG · Spot');assert.match(u.text(),/140.00 USDT/);
 choose(u,'SHORT · Futures');assert.match(u.text(),/45.00 USDT/);assert.equal(calls.length,2);
 u.nodes.find(n=>n.textContent==='רענון שווי התיק').events.click();assert.equal(calls.at(-1),'FUTURES');
});

test('a legacy Spot response cannot fill a Futures chart; actual session samples expire at Israel midnight and clear on account change',async()=>{
 let time=Date.parse('2026-11-17T21:55:00Z');
 const u=fixture(async()=>response,()=>time);
 u.panel.setContext({mode:'live',identity:'first'});await turn();
 u.panel.observeFutures({at:time,valueUsdt:57});choose(u,'SHORT · Futures');await turn();
 assert.doesNotMatch(u.text(),/140.00/);assert.match(u.text(),/57.00 USDT/);assert.match(u.text(),/הדף פתוח/);
 time+=60000;u.panel.observeFutures({at:time,valueUsdt:61});assert.match(u.text(),/\+4.00 USDT/);
 time+=60000;u.panel.observeFutures({at:time,valueUsdt:null});assert.match(u.text(),/שווי אחרון שנמדד/);
 time+=60000;u.panel.observeFutures({at:time,valueUsdt:50});assert.match(u.text(),/פערים בקו/);
 time=Date.parse('2026-11-17T22:00:01Z');u.panel.tick();await turn();assert.doesNotMatch(u.text(),/50.00 USDT/);
 u.panel.observeFutures({at:time,valueUsdt:12});assert.match(u.text(),/12.00 USDT/);
 u.panel.setContext({mode:'live',identity:'second'});await turn();assert.doesNotMatch(u.text(),/12.00|140.00/);
});

test('server Futures measurements take priority over current-session samples and zero remains a valid value',async()=>{
 const u=fixture(async market=>market==='SPOT'?response:futures);
 u.panel.setContext({mode:'live'});u.panel.observeFutures({at:1800000000000,valueUsdt:0});
 choose(u,'SHORT · Futures');assert.match(u.text(),/0.00 USDT/);await turn();
 assert.match(u.text(),/45.00 USDT/);assert.doesNotMatch(u.text(),/מאז הפתיחה/);
});

test('cached Futures daily statistics survive transport failures and clear on market mismatch, day change or authorization loss',async()=>{
 let time=1800000000000,reply=futures;
 const u=fixture(async venue=>{
  if(venue==='SPOT')return response;
  if(reply instanceof Error)throw reply;
  return reply;
 },()=>time);
 u.panel.setContext({mode:'live'});choose(u,'SHORT · Futures');await turn();
 reply=Object.assign(Error('timeout'),{status:504});await u.panel.load(true);
 assert.match(u.text(),/45.00 USDT/);assert.match(u.text(),/הגבוה היום/);assert.match(u.text(),/הרענון נכשל/);
 time+=86400000;u.panel.tick();await turn();assert.doesNotMatch(u.text(),/45.00 USDT/);
 time-=86400000;reply=response;await u.panel.load(true);assert.doesNotMatch(u.text(),/45.00 USDT|140.00 USDT/);
 reply=futures;await u.panel.load(true);assert.match(u.text(),/שווי התיק כעת/);assert.doesNotMatch(u.text(),/הרענון נכשל/);
 reply=Object.assign(Error('unauthorized'),{status:401});await u.panel.load(true);
 assert.doesNotMatch(u.text(),/45.00 USDT|140.00 USDT/);assert.match(u.text(),/חבר את המכשיר/);
});
