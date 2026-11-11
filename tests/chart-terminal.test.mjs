import test from 'node:test';
import assert from 'node:assert/strict';
import {createChartTerminal} from '../chart-terminal.js';
class Element {
 constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.attrs={};this.style={};this.events={};this.isConnected=true;this.classList={add(){},toggle(){}};}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 setAttribute(k,v){this.attrs[k]=String(v);}
 addEventListener(k,fn){this.events[k]=fn;}
 closest(){return null;}
 remove(){this.isConnected=false;}
 focus(){}setPointerCapture(){}releasePointerCapture(){}hasPointerCapture(){return false;}
 getBoundingClientRect(){return {left:0,top:0,width:800,height:400};}
}
function fixture(){
 const oldDocument=globalThis.document;
 const doc={body:new Element(),createElement:t=>new Element(t),createElementNS:(_,t)=>new Element(t),addEventListener(){}};
 globalThis.document=doc;
 const host=new Element(),toolbarHost=new Element(),shell=new Element(),calls=[];
 const terminal=createChartTerminal({host,toolbarHost,shell,navigation:()=>({zoom:(...a)=>calls.push(['zoom',...a]),move:a=>calls.push(['move',a])})});
 const bars=Array.from({length:50},(_,i)=>({openTime:Date.UTC(2026,10,1,12)+i*300000,open:100,high:102,low:99,close:101,volume:i===49?null:0}));
 const config={symbol:'TEST',interval:'5m',bars,width:800,height:400,low:99,high:102,bounds:{left:20,right:700,top:30,bottom:350}};
 terminal.update(config);
 const emit=(name,x,y,extra={})=>host.events[name]({clientX:x,clientY:y,pointerId:1,button:0,target:host,preventDefault(){},...extra});
 return {host,toolbarHost,calls,terminal,config,emit,restore:()=>{globalThis.document=oldDocument;}};
}
test('touch selection keeps missing volume unknown, real zero intact, and clears on asset change',()=>{
 const f=fixture();try{
  const fields=f.toolbarHost.children[1].children;
  assert.equal(fields[6].children[1].textContent,'—');
  f.emit('pointerdown',40,150);f.emit('pointerup',40,150);assert.equal(f.toolbarHost.children[1].dataset.pinned,'true');assert.equal(fields[6].children[1].textContent,'0');
  f.terminal.update({...f.config,symbol:'NEXT'});assert.equal(f.toolbarHost.children[1].dataset.pinned,'false');assert.equal(fields[6].children[1].textContent,'—');
  f.terminal.clear();assert.equal(fields[4].children[1].textContent,'—');
 }finally{f.restore();}
});
test('pan moves by candle distance; pinch zoom anchors at the fingers and drawing input is ignored',()=>{
 const f=fixture();try{
  f.emit('pointerdown',100,150);f.emit('pointermove',168,150);assert.deepEqual(f.calls.at(-1),['move',-5]);f.emit('pointerup',168,150);
  f.emit('pointerdown',200,150);f.emit('pointerdown',400,150,{pointerId:2});f.emit('pointermove',500,150,{pointerId:2});
  assert.equal(f.calls.at(-1)[0],'zoom');assert.ok(Math.abs(f.calls.at(-1)[1]-2/3)<1e-10);assert.ok(f.calls.at(-1)[2]>0&&f.calls.at(-1)[2]<1);
  f.emit('pointercancel',200,150);f.emit('pointercancel',500,150,{pointerId:2});
  const count=f.calls.length;f.emit('wheel',200,150,{deltaY:100,target:{closest:()=>({})}});assert.equal(f.calls.length,count);
 }finally{f.restore();}
});
test('candle-fit option starts enabled without removing the all-levels toggle',()=>{
 const f=fixture();try{
  const host=new Element(),tools=new Element();
  const t=createChartTerminal({host,toolbarHost:tools,shell:new Element(),navigation:()=>null,fitToCandles:true});
  assert.equal(t.fitCandles,true);
  const button=tools.children[0].children[1].children.find(x=>x.textContent==='גובה: נרות');
  assert.equal(button.attrs['aria-pressed'],'true');button.onclick();assert.equal(t.fitCandles,false);assert.equal(button.textContent,'גובה: כל הרמות');
 }finally{f.restore();}
});
