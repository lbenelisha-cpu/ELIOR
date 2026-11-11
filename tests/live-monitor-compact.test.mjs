import test from 'node:test';
import assert from 'node:assert/strict';
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attrs={};this.textContent='';this.classList={add(){},toggle:(key,value)=>{this.attrs[key]=value;}};}
 append(...n){this.children.push(...n);}replaceChildren(...n){this.children=n;}setAttribute(k,v){this.attrs[k]=v;}addEventListener(){}
}
const doc={createElement:t=>new Element(t),getElementById:()=>null,body:new Element('body'),hidden:false};
globalThis.document=doc;globalThis.Node=Element;globalThis.window={LEVI_TRADE_AUTH:{read:()=>null},addEventListener(){}};globalThis.setInterval=()=>0;
const {createLiveMonitor}=await import('../binance-live-monitor.js');
const all=e=>[e,...e.children.flatMap(all)];
const text=e=>all(e).map(n=>n.textContent).join(' ');
test('compact LIVE summary replaces duplicate rows and preserves unavailable Futures status',async()=>{
 const host=new Element('section');host.dataset.compact='true';
 let fail=false;
 const api=createLiveMonitor(host,{read:async()=>{if(fail)throw Error('offline');return {ok:true,mode:'live',asOf:Date.now(),spot:{equityUsdt:300,availableUsdt:250,openPnlUsdt:0,positions:[{symbol:'BTCUSDT',quantity:.0006,markPrice:73000}]},futures:{ok:false,error:'FUTURES_ENDPOINT_FORBIDDEN',walletUsdt:999,positions:[]},realized:{long:{net:2,known:1,unknown:0}},poc:{}};}});
 api.setConnected(true);await new Promise(setImmediate);
 assert.equal(doc.body.attrs['integrated-live-ready'],true);
 const table=all(host).find(n=>n.tag==='table');assert.ok(table);assert.match(text(table),/300.00/);assert.doesNotMatch(text(table),/999.00/);
 assert.match(text(host),/FUTURES_ENDPOINT_FORBIDDEN/);assert.match(text(host),/היסטוריה/);
 assert.equal(all(host).filter(n=>n.tag==='table').length,1);assert.doesNotMatch(text(host),/נכסים מוחזקים|אין כרגע הוראות/);
 fail=true;await api.load();assert.equal(doc.body.attrs['integrated-live-ready'],false);assert.equal(all(host).filter(n=>n.tag==='table').length,0);assert.match(text(host),/נתונים קודמים הוסתרו/);
});
