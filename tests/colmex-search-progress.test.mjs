import test from 'node:test';import assert from 'node:assert/strict';
import {chartAnalysisMarks} from '../lib/colmex-chart-view.mjs';
import {evaluateWyckoff} from '../lib/wyckoff-strategy.mjs';
import {searchProgress} from '../lib/colmex-search-progress.mjs';
import {wyckoffArrowPoints,arrowLayout,drawWyckoffArrows} from '../lib/colmex-wyckoff-arrows.mjs';
import {renderSearchStatus} from '../colmex-search-status.js';
const start=Date.parse('2026-10-26T13:30:00Z');
const candles=[[99,101,98,100],[100,103,99,102],[102,105,101,104],[104,104.5,100,101],[101,103,100.5,102]].map(([open,high,low,close],i)=>({date:new Date(start+i*300000).toISOString(),open,high,low,close}));
test('a rising eligible peak becomes a neutral candidate, then a confirmed peak only after a closed retreat',()=>{
 const now=start+900000,marks=chartAnalysisMarks(candles,now);assert.equal(marks.searchDiagnostic.phase,'SEARCH_PEAK');assert.equal(marks.points.length,1);assert.equal(marks.points[0].kind,'candidatePeak');assert.equal(marks.points[0].price,105);assert.equal(marks.points[0].at,now);assert.equal(marks.points[0].pulse,false);assert.ok(marks.searchProgress.stages.every(s=>!s.done));assert.equal(marks.lines.length,0);
 const retreat=chartAnalysisMarks(candles,now+300000);assert.equal(retreat.searchDiagnostic.phase,'FIRST_LOW');assert.deepEqual(retreat.points.map(p=>p.kind),['initialPeak','candidateLow']);assert.equal(retreat.searchProgress.stages[0].done,true);assert.equal(retreat.searchProgress.stages[1].done,false);
 const rebound=chartAnalysisMarks(candles,now+600000);assert.deepEqual(rebound.points.map(p=>p.kind),['initialPeak','firstLow','candidateRally']);
 const afterSale=chartAnalysisMarks(candles,now,{after:now});assert.equal(afterSale.points.length,0);assert.match(afterSale.searchProgress.next,/שני נרות ירוקים/);
});
test('diagnostic candidates never alter decisions and no arbitrary high is manufactured',()=>{
 const rows=candles.map(({date,...b})=>({...b,closeTime:Date.parse(date)+300000,timeframe:'5m'}));
 for(let n=3;n<=rows.length;n++){const bars=rows.slice(0,n),options={timeframe:'5m',rollingSearch:true,now:bars.at(-1).closeTime};const normal=evaluateWyckoff(bars,options),{searchCandidate,searchReset,...diagnostic}=evaluateWyckoff(bars,{...options,diagnostics:true});assert.deepEqual(diagnostic,normal);}
 const red=candles.slice(0,3).map(b=>({...b,open:b.close,close:b.open}));assert.equal(chartAnalysisMarks(red,start+900000).points.length,0);
 const pending=searchProgress({phase:'SECONDARY_TEST',testCandidate:{time:start,price:99},lowCandidate:{time:start,price:88}});assert.equal(pending.candidate.kind,'candidateTest');assert.equal(pending.candidate.price,99);
 assert.equal(searchProgress({phase:'SEARCH_PEAK',searchCandidate:{time:start,price:NaN}}).candidate,null);
});
class Element{constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.textContent='';}setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k];}append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}}
test('candidate labels stay above highs or below lows, with dashed outlines, hollow arrows and no blinking',()=>{
 for(const count of [3,4]){const marks=chartAnalysisMarks(candles,start+count*300000),points=wyckoffArrowPoints(marks.points,[],candles,'5min'),candidate=points.find(p=>p.provisional);assert.ok(candidate);assert.equal(candidate.pulse,false);assert.equal(candidate.index,count-1);assert.equal(arrowLayout([candidate],()=>100,()=>150)[0].above,count===3);
 const svg=new Element('svg');drawWyckoffArrows({svg,points:[candidate],x:()=>100,y:()=>150,document:{createElementNS:(ns,tag)=>new Element(tag)}});const group=svg.children[0];assert.match(group.attrs['aria-label'],/מועמד/);assert.equal(group.children.find(c=>c.tag==='polygon').attrs.fill,'#08111f');assert.ok(group.children.some(c=>c.attrs['stroke-dasharray']==='3 3'));assert.equal(group.attrs.class,undefined);}
});
test('progress disclosure preserves the user choice on refresh and resets for a different stock',()=>{
 const prior=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};
 try{const host=new Element('section'),marks=chartAnalysisMarks(candles,start+900000),options={symbol:'AAPL',progress:marks.searchProgress},render=()=>renderSearchStatus(host,marks.searchDiagnostic,options),details=()=>host.children.find(c=>c.tag==='details');
 render();assert.equal(details().open,false);details().open=true;details().ontoggle();render();assert.equal(details().open,true);assert.match(details().children.at(-1).textContent,/גל מוקדם/);
 renderSearchStatus(host,marks.searchDiagnostic,{...options,symbol:'MSFT'});assert.equal(details().open,false);
 renderSearchStatus(host,marks.searchDiagnostic,{...options,position:true});assert.equal(details(),undefined);
 }finally{globalThis.document=prior;}
});
