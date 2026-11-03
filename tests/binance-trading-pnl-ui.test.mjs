import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const now=Date.UTC(2026,10,2,15),tick=()=>new Promise(r=>setImmediate(r));
function fixture(read,options={}){
 const nodes=[],downloads=[];
 function element(tag){const n={tag,children:[],textContent:'',hidden:false,value:'',events:{},append(...xs){this.children.push(...xs);if(tag==='select'&&!this.value)this.value=xs[0]?.value||'';},replaceChildren(...xs){this.children=xs;},setAttribute(k,v){this[k]=v;},addEventListener(k,fn){this.events[k]=fn;}};nodes.push(n);return n;}
 const source=fs.readFileSync(new URL('../binance-trading-pnl.js',import.meta.url),'utf8').split("const host=document.getElementById('binanceTradingPnl');")[0].replaceAll('export function','function');
 const context=vm.createContext({document:{createElement:element},Date,Intl,Number,Error,Array,JSON,Object,Map,String});vm.runInContext(source,context);
 const host=element('section'),panel=context.createTradingPnlPanel(host,{read,now:()=>now,download:(...args)=>downloads.push(args),...options}),text=n=>n.textContent+n.children.map(text).join('|');
 return {panel,nodes,downloads,text:()=>text(host),context};
}
const row={id:'1',symbol:'TESTUSDT',direction:'LONG',market:'SPOT',entryAt:now-300000,closedAt:now-1000,qty:1,entryPrice:10,exitPrice:11,costUsdt:10,fees:[{asset:'USDT',amount:.1}],fundingUsdt:0,netPnlUsdt:.9,netPnlPct:9,status:'CLOSED',reason:'MANUAL_SELL',issue:null};
const data={ok:true,asOf:now,rows:[row,{...row,id:'2',direction:'SHORT',netPnlUsdt:-.3,netPnlPct:-3},{...row,id:'3',netPnlUsdt:null,netPnlPct:null,issue:'MISSING_ENTRY_COST'}],issues:[],loadingShort:false};
test('unified table sums both directions, counts unknown separately and exports the filtered rows',async()=>{
 const u=fixture(async()=>data);u.panel.setContext({mode:'live',visible:true});await tick();assert.match(u.text(),/\+0.6 USDT/);assert.match(u.text(),/סכום חלקי/);assert.match(u.text(),/1 ללא חישוב נטו/);
 const select=u.nodes.find(n=>n['aria-label']==='כיוון');select.value='SHORT';select.events.change();assert.doesNotMatch(u.text(),/\+0.9 USDT/);
 u.nodes.find(n=>n.tag==='button'&&n.textContent==='ייצוא CSV לאקסל').events.click();assert.equal(u.downloads.length,1);assert.match(u.downloads[0][0],/SHORT/);assert.doesNotMatch(u.downloads[0][0],/"LONG"/);
});
test('time filtering uses Israel calendar days, preserves zero and does not average percentages',()=>{
 const u=fixture(async()=>data),rows=[{...row,netPnlUsdt:0,closedAt:Date.UTC(2026,10,1,22,5)},{...row,closedAt:Date.UTC(2026,10,1,21,55)}];
 const filtered=u.context.filterPnlRows(rows,{period:'today'},now);assert.equal(filtered.length,1);const summary=u.context.summarizePnl(filtered);assert.equal(summary.net,0);assert.equal(summary.known,1);assert.equal(summary.flat,1);assert.equal(summary.winRate,0);
});
test('private responses are discarded after disconnect or switching to demo',async()=>{
 for(const mode of ['demo','disconnected']){let resolve;const u=fixture(()=>new Promise(r=>resolve=r));u.panel.setContext({mode:'live',visible:true});u.panel.setContext({mode,visible:true});resolve(data);await tick();assert.doesNotMatch(u.text(),/TESTUSDT/);assert.equal(u.nodes.find(n=>n.textContent==='ייצוא CSV לאקסל').disabled,true);}
});
test('hidden reports do not poll and failed refresh removes old totals',async()=>{
 let calls=0;const u=fixture(async()=>{if(calls++)throw Error('failure');return data;});u.panel.setContext({mode:'live',visible:false});await tick();assert.equal(calls,0);u.panel.setContext({mode:'live',visible:true});await tick();assert.equal(calls,1);u.panel.setContext({mode:'live',visible:true});await tick();assert.equal(calls,1);await u.panel.load(true);assert.doesNotMatch(u.text(),/TESTUSDT/);assert.match(u.text(),/לא ניתן לטעון/);
});
test('CSV protects against spreadsheet formulas and rendered text never becomes HTML',async()=>{
 const attack={...row,symbol:'=HYPERLINK("x")',reason:'<img src=x onerror=alert(1)>'},u=fixture(async()=>({...data,rows:[attack]}));u.panel.setContext({mode:'live',visible:true});await tick();assert.match(u.text(),/<img src=x/);assert.ok(u.nodes.every(n=>!Object.hasOwn(n,'innerHTML')));assert.match(u.context.pnlCsv([attack]),/"'=HYPERLINK/);
});

test('overview shares the reader with the full report, publishes accounting changes and polls once per minute',async()=>{
 let at=now,calls=0,events=[];const u=fixture(async()=>{calls++;return data;},{now:()=>at,onData:d=>events.push(d)});
 u.panel.setContext({mode:'live',visible:true,refreshMs:60000});await tick();assert.equal(calls,1);assert.equal(events.at(-1).ok,true);
 at+=15000;u.panel.setContext({mode:'live',visible:true,refreshMs:60000});await tick();assert.equal(calls,1);
 at+=45000;u.panel.setContext({mode:'live',visible:true,refreshMs:60000});await tick();assert.equal(calls,2);
 u.panel.setContext({mode:'disconnected',visible:true});assert.equal(events.at(-1),null);
});
