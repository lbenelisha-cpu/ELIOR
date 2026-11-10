import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {pocFixture as sourcePocFixture} from './helpers/poc-channel-fixture.mjs';
const pocFixture=options=>sourcePocFixture({...options,legacy:true});import {POC_MODEL} from '../lib/channel-poc-entry.mjs';
import {drawSignalChart} from '../poc-signal-chart.js';import {createFixedRangeVolumeProfile} from '../fixed-range-volume-profile.js';
function dom(){const doc={createElement:tag=>element(tag),createElementNS:(_,tag)=>element(tag)};function element(tag){return {tag,ownerDocument:doc,attributes:{},dataset:{},style:{},children:[],textContent:'',isConnected:true,classList:{add(){}},setAttribute(k,v){this.attributes[k]=v;},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},addEventListener(){}};}return {doc,element};}
const flatten=n=>[n,...n.children.flatMap(flatten)];
for(const side of ['LONG','SHORT'])test(side+' chart displays the server frozen POC, bins and channel without recomputing from visible candles',()=>{
 const {doc,element}=dom(),prior=globalThis.document;globalThis.document=doc;try{
 const i=pocFixture({side}),r=POC_MODEL.analyze({...i,side}),host=element('div');drawSignalChart(host,{symbol:'ABCUSDT',market:side==='SHORT'?'Binance Futures':'Binance Spot',conditions:r.conditions},i.now);
 const all=flatten(host),line=all.find(n=>n.attributes['data-poc-level']);assert.equal(line.attributes['data-poc-level'],r.model.profile.poc);assert.equal(all.filter(n=>n.attributes['data-frozen-channel']).length,2);
 assert.equal(all.filter(n=>n.attributes['data-poc-bin']!==undefined).length,r.model.profile.volumes.filter(v=>v>0).length);
 assert.ok(all.some(n=>n.textContent==='A'));assert.ok(all.some(n=>n.textContent==='B'));assert.ok(all.some(n=>n.textContent.includes(side)));
 for(const n of all)for(const [k,v]of Object.entries(n.attributes))if(['x','x1','x2','y','y1','y2','width','height','cx','cy'].includes(k))assert.ok(Number.isFinite(Number(v)),k);
 drawSignalChart(host,{symbol:'ABCUSDT',market:'Binance Futures',conditions:r.conditions},i.now+300001);assert.ok(flatten(host).some(n=>n.textContent.includes('תמונת מצב קודמת')));
 }finally{globalThis.document=prior;}
});
test('missing profile data has a clear message and never displays an invented POC',()=>{
 const {doc,element}=dom(),prior=globalThis.document;globalThis.document=doc;try{const host=element('div');drawSignalChart(host,{symbol:'ABCUSDT',market:'Futures',conditions:{model:{profile:null},chart:{bars:[]}}});assert.equal(flatten(host).some(n=>n.tag==='svg'),false);}finally{globalThis.document=prior;}
});
test('automatic profile is the default, manual selection remains separate, and clear removes prior asset evidence',()=>{
 const {doc,element}=dom(),prior=globalThis.document;globalThis.document=doc;try{
 const host=element('div'),toolbar=element('div'),ui=createFixedRangeVolumeProfile({host,toolbarHost:toolbar}),i=pocFixture(),r=POC_MODEL.analyze({...i,side:'LONG'});
 const config={symbol:'ABCUSDT',interval:'5m',bars:i.bars.map(b=>({...b,time:b.openTime})),models:{LONG:r.model},sourceBars:i.bars,width:800,height:400,bounds:{left:20,right:700,top:20,bottom:350},x:n=>20+n*10,y:p=>350-(p-100)*20};ui.update(config);
 assert.equal(ui.isAutomatic(),true);assert.ok(flatten(host).some(n=>n.attributes['data-poc-level']===r.model.profile.poc));
 const manual=flatten(toolbar).find(n=>n.tag==='button'&&n.textContent.includes('בחר טווח'));manual.onclick();assert.equal(ui.isAutomatic(),false);assert.equal(flatten(host).some(n=>n.attributes['data-poc-model']),false);
 const auto=flatten(toolbar).find(n=>n.tag==='button'&&n.textContent.includes('אוטומטי'));auto.onclick();assert.equal(ui.isAutomatic(),true);
 ui.update({...config,symbol:'OTHERUSDT',models:null});assert.equal(flatten(host).some(n=>n.attributes['data-poc-model']),false);ui.clear();assert.equal(flatten(host).some(n=>n.attributes['data-poc-level']),false);
 }finally{globalThis.document=prior;}
});
test('both apps use server POC models; Futures uses its own market bars and TradingView saved layout',()=>{
 const bin=fs.readFileSync(new URL('../binance-agent.js',import.meta.url),'utf8'),colmex=fs.readFileSync(new URL('../colmex-pro.js',import.meta.url),'utf8'),attention=fs.readFileSync(new URL('../market-attention.js',import.meta.url),'utf8');
 assert.match(bin,/entryDecisions\?\.channel\?\.conditions\?\.model/);assert.match(colmex,/conditionReports\?\.\[side\]\?\.model/);assert.match(attention,/symbol:o.futuresSymbol,market:'Binance Futures',conditions:o.conditions/);assert.match(attention,/CHANNEL_POC_RETEST_V1/);
 const pine=fs.readFileSync(new URL('../tradingview/levi-channels.pine',import.meta.url),'utf8');assert.match(pine,/Show fixed range volume profile/);assert.match(pine,/Show regression \(display only\)/);assert.match(pine,/vpPriceA/);assert.match(pine,/POC estimate/);
});
