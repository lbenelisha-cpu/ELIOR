import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createMarketLoadGate} from '../lib/colmex-market-loading.mjs';
import {chartAnalysisMarks} from '../lib/colmex-chart-view.mjs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const script=read('colmex-pro.js');
class Element{
 constructor(){this.dataset={};this.children=[];this.elements={entry:{},qty:{},mark:{}};this.value='';this.style={};this.classList={add(){},remove(){},toggle(){}};}
 append(...children){this.children.push(...children);}replaceChildren(...children){this.children=[...children];}setAttribute(){}addEventListener(){}
}
async function boot(mode){
 const html=read(mode==='simulation'?'colmex-simulation.html':'colmex-pro.html'),nodes=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>['#'+m[1],new Element()]));
 nodes.get('#marketInterval').value='5min';nodes.get('#autoMarket').checked=false;
 const document={body:{dataset:{mode}},hidden:true,querySelector:s=>nodes.get(s)||null,querySelectorAll:()=>[],createElement:()=>new Element(),addEventListener(){}};
 const saved={symbols:['TSLA'],positions:{TSLA:{entry:351,qty:2,mark:999,updatedAt:'2026-10-21T13:00:00Z'}},drawings:{},bars:{}};
 let paperLoads=0;const watched=[];
 const deps={createMarketLoadGate,syncWatchRows:(body,symbols,options)=>watched.push({symbols:[...symbols],tsla:options.describe('TSLA')}),lastTwoTradingDays:()=>[],startCandleFlashing(){},validDrawing:()=>true,loadPaperUI:async()=>{paperLoads++;return {initSimulation(){},simulationMarks:()=>({points:[],cards:[],lines:[]}),simulationWyckoffHistory:()=>[]};}};
 const names=[...script.matchAll(/^import \{([^}]+)\} from .*;$/gm)].flatMap(m=>m[1].split(',').map(x=>x.trim()));
 const source=script.replace(/^import .*;\n/gm,'').replace("import('./colmex-simulation-ui.js?v=20261017-occurrences')",'deps.loadPaperUI()');
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const execute=new AsyncFunction('deps','document','localStorage','fetch','setInterval',`const {${names.join(',')}}=deps;\n${source}`);
 await execute(deps,document,{getItem:key=>key.endsWith('-quotes')?null:JSON.stringify(saved),setItem(){}},async()=>({ok:false,json:async()=>({error:'test provider unavailable'})}),()=>{});
 return {nodes,paperLoads,watched,html};
}
test('LIVE page starts without paper DOM, never loads simulation and ignores local paper prices',async()=>{
 const r=await boot('live');assert.equal(r.paperLoads,0);assert.equal(r.nodes.has('#simulationSummary'),false);assert.equal(r.nodes.has('#positionForm'),false);assert.equal(r.nodes.has('#brokerAccount'),true);assert.equal(r.nodes.get('#watchCount').textContent,'20');assert.equal(r.nodes.get('#selectedPrice').textContent,'—');assert.ok(!r.watched[0].tsla.text.includes('999'));assert.match(r.html,/href="\/colmex-simulation.html"/);
});
test('separate simulation page retains history and local records, without live account or execution controls',async()=>{
 const r=await boot('simulation');assert.equal(r.paperLoads,1);assert.equal(r.nodes.has('#simulationJournal'),true);assert.equal(r.nodes.has('#positionForm'),true);assert.equal(r.nodes.has('#brokerAccount'),false);assert.equal(r.nodes.has('#colmexManualBuy'),false);assert.ok(r.nodes.get('#selectedPrice').textContent.includes('999'));assert.doesNotMatch(r.html,/src="\/colmex-(?:account|manual-ui|auto-ui)\.js/);
});
test('chart analysis alone never manufactures simulated positions, entry, peak or stop lines',()=>{
 const now=Date.parse('2026-10-21T14:30:00Z'),bars=Array.from({length:12},(_,i)=>({date:new Date(now-(12-i)*300000).toISOString(),open:100+i,high:102+i,low:99+i,close:101+i,volume:100}));
 const marks=chartAnalysisMarks(bars,now);assert.deepEqual(marks.lines,[]);assert.ok(marks.cards.every(p=>!['buy','sell','peak','stop'].includes(p.kind)));assert.deepEqual(chartAnalysisMarks([],now),{points:[],cards:[],lines:[]});assert.doesNotThrow(()=>chartAnalysisMarks(bars.filter((_,i)=>i!==5),now));
});
