import test from 'node:test';import assert from 'node:assert/strict';
import {wyckoffArrowPoints,arrowLayout,drawWyckoffArrows,wyckoffEdgeBands} from '../lib/colmex-wyckoff-arrows.mjs';
import {COLMEX_MARK_TYPES} from '../lib/colmex-chart-marks.mjs';
const start=Date.parse('2026-10-21T13:30:00Z');
const bars=Array.from({length:10},(_,i)=>({date:new Date(start+i*300000).toISOString()}));
const setup=Object.fromEntries(COLMEX_MARK_TYPES.map(([kind],i)=>[kind,{time:start+(i+1)*300000,price:100+i}]));
test('incomplete stages get arrows without inventing a confirmed pattern or a buy',()=>{
 const points=wyckoffArrowPoints([{kind:'initialPeak',at:start+300000,price:110,anchor:'close'},{kind:'firstLow',at:start+600000,price:100,anchor:'close'}],[],bars,'5min');
 assert.deepEqual(points.map(p=>[p.kind,p.index,p.pulse]),[['initialPeak',0,true],['firstLow',1,true]]);assert.ok(points.every(p=>p.number===undefined));
});
test('historical numbered stages are deduplicated and retain candle close versus live-event anchors',()=>{
 const result=wyckoffArrowPoints([{kind:'initialPeak',at:setup.initialPeak.time,price:100,anchor:'close'}],[{setup,number:2}],bars,'5min');
 assert.equal(result.length,6);assert.deepEqual(result.map(p=>p.index),[0,1,2,3,4,5]);assert.ok(result.every(p=>p.number===2&&p.pulse));
 const live={...setup,confirmation:{...setup.confirmation,live:true}};
 assert.equal(wyckoffArrowPoints([],[{setup:live,number:1}],bars,'5min').at(-1).index,6);
 const outside=wyckoffArrowPoints([{kind:'springLow',price:90,at:start-1},{kind:'springLow',price:90,at:start+99999999}],[],bars,'5min');assert.equal(outside.length,0);
});
test('high arrows point down, low arrows up, tips stay at actual values and colliding labels separate',()=>{
 const points=wyckoffArrowPoints([],[{setup,number:1}],bars,'5min');
 const result=arrowLayout(points,()=>400,()=>150);
 for(const a of result){assert.equal(a.px,400);assert.equal(a.py,150);assert.ok(a.head.startsWith('400,150 '));assert.ok(a.box);assert.ok(a.box.left>=16&&a.box.right<=758);}
 assert.equal(result[0].above,true);assert.ok(result[0].tailY<150);assert.equal(result[1].above,false);assert.ok(result[1].tailY>150);
 for(let i=0;i<result.length;i++)for(let j=0;j<i;j++){const a=result[i].box,b=result[j].box;assert.ok(a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom);}
});
class Element{constructor(tag){this.tag=tag;this.children=[];this.attrs={};}setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k];}append(el){this.children.push(el);}}
test('SVG arrows are keyboard accessible and report exact selected point; arrows never blink',()=>{
 const points=wyckoffArrowPoints([{kind:'buy',at:start,anchor:'event',price:105},{kind:'sell',at:start+300000,anchor:'event',price:108}],[],bars,'5min');
 const svg=new Element('svg');let selected,stopped=0,prevented=0;
 drawWyckoffArrows({svg,points,x:i=>50+i*50,y:p=>250-p,document:{createElementNS:(ns,tag)=>new Element(tag)},onSelect:p=>selected=p});
 assert.equal(svg.children.length,2);assert.ok(svg.children[0].getAttribute('aria-label').includes('B · קנייה מדומה'));assert.ok(svg.children[1].getAttribute('aria-label').includes('S · מכירה מדומה'));
 assert.equal(svg.children[0].getAttribute('tabindex'),'0');assert.ok(svg.children.every(g=>g.children.some(c=>c.tag==='polygon')));
 svg.children[0].onclick({stopPropagation(){stopped++;}});assert.equal(selected.price,105);
 svg.children[1].onkeydown({key:'Enter',stopPropagation(){stopped++;},preventDefault(){prevented++;}});assert.equal(selected.price,108);assert.equal(stopped,2);assert.equal(prevented,1);
 assert.ok(svg.children.every(g=>!g.attrs.class));
});

test('edge bands keep every caption outside the plot, even for dense numbered history',()=>{
 const points=Array.from({length:12},(_,i)=>wyckoffArrowPoints([],[{setup,number:i+1}],bars,'5min')).flat();
 const x=()=>400,bounds=wyckoffEdgeBands(points,x),layout=arrowLayout(points,x,()=>bounds.top+125,bounds);
 assert.equal(layout.length,72);assert.equal(bounds.bottom-bounds.top,250);
 for(const a of layout){assert.ok(a.above?a.box.bottom<bounds.top:a.box.top>bounds.bottom);assert.ok(a.box.bottom<bounds.height-43);}
 for(let i=0;i<layout.length;i++)for(let j=0;j<i;j++){const a=layout[i].box,b=layout[j].box;assert.ok(a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom);}
});
