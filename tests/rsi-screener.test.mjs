import test from 'node:test';
import assert from 'node:assert/strict';
import {rsiSnapshot,screenRsiRows} from '../lib/rsi-screener.mjs';
import {rsiSeries} from '../lib/wyckoff-spring-rsi.mjs';
const bucket=Date.UTC(2026,9,23,10);
const bars=Array.from({length:30},(_,i)=>({close:100-i,closeTime:bucket-(29-i)*300000-1}));
test('RSI screen includes a valid open five-minute quote and never modifies input bars',()=>{
 const before=JSON.stringify(bars),live={close:72,observedAt:bucket+10000};
 const r=rsiSnapshot(bars,live);
 assert.equal(r.value,rsiSeries([...bars.map(b=>b.close),72]).at(-1));
 assert.equal(r.at,live.observedAt);assert.equal(r.includesOpenCandle,true);
 assert.equal(JSON.stringify(bars),before);
 assert.equal(rsiSnapshot(bars,{close:90,observedAt:bucket+600000}).includesOpenCandle,false);
 assert.equal(rsiSnapshot([],live).value,null);
});
test('ranges include exact 0/30/70/100, reject missing data, sort and mark old observations',()=>{
 const rows=[0,30,70,100,null,undefined].map((value,i)=>({symbol:'S'+i,rsi:{value,at:bucket}}));
 assert.deepEqual(screenRsiRows(rows,{min:0,max:30,now:bucket}).map(r=>r.rsi.value),[0,30]);
 assert.deepEqual(screenRsiRows(rows,{min:70,max:100,order:'desc',now:bucket}).map(r=>r.rsi.value),[100,70]);
 assert.equal(screenRsiRows(rows,{now:bucket+900001})[0].old,true);
 assert.equal(screenRsiRows([{symbol:'N',rsi:null}]).length,0);
});
test('controls update results and chart selection locally, without trade or network actions',async()=>{
 class El{constructor(tag){this.tag=tag;this.children=[];this.value='';this.attrs={};}append(...items){this.children.push(...items);}replaceChildren(){this.children=[];}setAttribute(k,v){this.attrs[k]=v;}}
 const old=globalThis.document;globalThis.document={createElement:t=>new El(t)};
 try{
  const {createRsiScreener}=await import('../rsi-screener.js');const host=new El('div');let selected;
  const ui=createRsiScreener(host,{scope:'test',onSelect:s=>selected=s});
  ui.update([{symbol:'LOW',rsi:{value:20,at:Date.now()},spring:true},{symbol:'HIGH',rsi:{value:80,at:Date.now()}},{symbol:'MISSING',rsi:null}]);
  const box=host.children[0],controls=box.children[2],results=box.children[4];
  assert.equal(results.children.length,2);const preset=controls.children[0];preset.value='low';preset.onchange();
  assert.equal(results.children.length,1);assert.match(results.children[0].textContent,/LOW.*20.00/);
  results.children[0].onclick();assert.equal(selected,'LOW');
  const min=controls.children[1].children[0];min.value='90';min.oninput();assert.match(box.children[3].textContent,/טווח תקין/);
 }finally{globalThis.document=old;}
});
