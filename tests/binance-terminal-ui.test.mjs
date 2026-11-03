import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {terminalView} from '../lib/binance-terminal-view.mjs';
const now=Date.UTC(2026,10,3,14),snapshot={mode:'live',receivedAt:now,account:{totalValueUsdt:100,usdtFree:50,balances:[{asset:'ETH',qty:1,usdtPrice:50,valueUsdt:50,pnlIls:0}]}};
function fixture(){
 const elements=new Map();const make=()=>({children:[],textContent:'',dataset:{},append(...x){this.children.push(...x);},replaceChildren(...x){this.children=x;}});
 const get=id=>{if(!elements.has(id))elements.set(id,make());return elements.get(id);};
 const doc={getElementById:get,createElement:make};
 const source=fs.readFileSync(new URL('../binance-terminal.js',import.meta.url),'utf8').split("const host=document.getElementById('terminalHoldingsBody');")[0].replace(/^import .*?;\n/gm,'').replaceAll('export function','function');
 const c=vm.createContext({document:doc,terminalView,Date,Intl,Number});vm.runInContext(source,c);
 const ui=c.createTerminalDashboard(doc,{now:()=>now}),text=n=>n.textContent+n.children.map(text).join('|');return {ui,get,text:id=>text(get(id))};
}
test('overview renders unknown results, zero open P/L and escaped text; disconnect clears both tables',()=>{
 const u=fixture();u.ui.setSnapshot(snapshot);assert.match(u.text('terminalHoldingsBody'),/ETHUSDT/);assert.match(u.text('terminalHoldingsBody'),/0.00/);
 u.ui.setReport({ok:true,asOf:now,issues:[],rows:[{symbol:'<img onerror=x>',direction:'SHORT',closedAt:now-1,status:'PARTIAL',netPnlUsdt:null,reason:'<script>x</script>',issue:'MISSING_ENTRY_COST'}]});
 assert.equal(u.text('terminalRealized'),'—');assert.match(u.text('terminalRealizedNote'),/סכום חלקי/);assert.match(u.text('terminalClosedBody'),/יציאה חלקית/);assert.match(u.text('terminalClosedBody'),/<img onerror=x>/);assert.equal(u.get('terminalClosedBody').innerHTML,undefined);
 u.ui.clear();assert.doesNotMatch(u.text('terminalHoldingsBody'),/ETHUSDT/);assert.doesNotMatch(u.text('terminalClosedBody'),/<img/);assert.equal(u.text('terminalClosedCount'),'—');
});
test('quote expiration or report error clears prior totals instead of retaining a green result',()=>{
 const u=fixture();u.ui.setSnapshot(snapshot);u.ui.setReport({ok:true,asOf:now,issues:[],rows:[{symbol:'ETHUSDT',direction:'LONG',closedAt:now-1,netPnlUsdt:2}]});assert.equal(u.text('terminalRealized'),'+2.00');
 u.ui.setReport(null);assert.equal(u.text('terminalRealized'),'—');u.ui.setSnapshot({...snapshot,receivedAt:now-61000});assert.doesNotMatch(u.text('terminalHoldingsBody'),/ETHUSDT/);
});
