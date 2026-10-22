import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {monitorView} from '../lib/colmex-monitor-view.mjs';
const now=Date.now();
test('all configured symbols remain visible, with missing and old checks distinguished',()=>{
 const v=monitorView({enabled:true,lastCompletedAt:now,policy:{symbols:['AAPL','MSFT','NVDA']},checks:{AAPL:{at:now-1000,reason:'SPRING'},MSFT:{at:now-1900000,reason:'SEARCH_PEAK'}}},now);
 assert.equal(v.total,3);assert.equal(v.checked,2);assert.deepEqual(v.rows.map(r=>r.state),['checked','old','unseen']);assert.equal(v.health,'recent');
});
test('fresh screen reads cannot disguise stale, failed, disabled or missing server cycles',()=>{
 const d={enabled:true,lastCompletedAt:now-360000};assert.equal(monitorView(d,now).health,'stale');
 assert.equal(monitorView({...d,lastCompletedAt:now,lastError:{reason:'NETWORK'}},now).health,'error');
 assert.equal(monitorView({...d,enabled:false},now).health,'disabled');
 assert.equal(monitorView({enabled:true,lastCycleAt:now},now).health,'waiting');
});
function ui(){
 const nodes=new Map();const timers=[];const requests=[];
 const el=()=>({textContent:'',children:[],dataset:{},disabled:false,append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},addEventListener(type,cb){this[type]=cb;}});
 const data={enabled:true,status:'MONITORING',lastCompletedAt:now,lastResult:'SEARCH_PEAK',policy:{symbols:['AAPL','MSFT']},checks:{AAPL:{at:now,reason:'SEARCH_PEAK'}},historyQuality:{symbol:'AAPL',discarded:10,usableBars:25}};
 let fail=false;
 const context=vm.createContext({monitorView,document:{hidden:false,addEventListener(){},getElementById(id){if(!nodes.has(id))nodes.set(id,el());return nodes.get(id);},createElement:el},fetch:async(url,options)=>{requests.push({url,options});if(fail)throw Error('network');return {ok:true,json:async()=>data};},Date,AbortSignal,setInterval:(fn,ms)=>timers.push({fn,ms})});
 vm.runInContext(fs.readFileSync(new URL('../colmex-auto-ui.js',import.meta.url),'utf8').replace(/^import .*;\n/,''),context);
 return {context,nodes,timers,requests,setFail:()=>{fail=true;}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('monitor displays recorded results and all rows; refresh reads status only',async()=>{
 const u=ui();await flush();assert.equal(u.nodes.get('autoLiveChecks').children.length,2);
 assert.match(u.nodes.get('autoLiveChecks').children[0].children[1].textContent,/מחפש שיא ראשוני/);
 await u.nodes.get('autoMonitorRefresh').click();
 assert.equal(u.requests.length,2);assert.ok(u.requests.every(r=>r.url==='/.netlify/functions/colmex-auto-status'&&!r.options.method));
 u.timers.find(t=>t.ms===30000).fn();assert.equal(u.nodes.get('autoMonitorHistory').children.length,1);
});
test('failed status fetch removes live assurance and old rows',async()=>{
 const u=ui();await flush();u.setFail();await u.nodes.get('autoMonitorRefresh').click();
 assert.equal(u.nodes.get('autoMonitorHealth').dataset.health,'error');assert.equal(u.nodes.get('autoLiveChecks').children.length,0);assert.equal(u.nodes.get('autoMonitorRefresh').disabled,false);
});
