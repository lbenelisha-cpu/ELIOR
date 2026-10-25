import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as math from '../lib/colmex-dashboard-math.mjs';
import {monitorView} from '../lib/colmex-monitor-view.mjs';
function ui({account=null,status=null}={}){
 const elements=new Map(),events={};
 const element=()=>({children:[],textContent:'',dataset:{},style:{setProperty(){}},append(...n){this.children.push(...n);},replaceChildren(...n){this.children=n;},addEventListener(){}});
 const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 const window={LEVI_COLMEX_ACCOUNT:account,LEVI_COLMEX_STATUS:status,addEventListener:(name,fn)=>events[name]=fn};
 vm.runInNewContext(fs.readFileSync(new URL('../colmex-dashboard.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),{...math,monitorView,window,document:{getElementById:get,createElement:element,querySelector:()=>element()},Date,Intl,setInterval(){}});
 const text=n=>n.textContent+n.children.map(text).join('|');return {get,text:id=>text(get(id)),emit:(name,detail)=>events[name]({detail})};
}
const fixture=()=>({data:{selectedAccount:{id:'1',name:'USD account',currency:'USD'},observedAt:new Date().toISOString(),state:{projectedBalance:1000,cashBalance:0,openNetPnL:-2},positions:[]}});
const status=()=>({data:{enabled:true,lastCompletedAt:Date.now(),positions:[],policy:{symbols:['AAPL'],notionalUsd:800,maxPositions:3}},error:false});
test('initial snapshots render immediately even when their events predate module loading',()=>{
 const u=ui({account:fixture(),status:status()});assert.equal(u.text('colmexEquity'),'1,000');assert.equal(u.text('colmexCash'),'0');assert.equal(u.text('colmexOpenPnl'),'-2');assert.equal(u.get('colmexServerHealth').dataset.state,'good');
});
test('failed and stale account snapshots cannot display balances as current',()=>{
 const u=ui({account:fixture(),status:status()});u.emit('levi:colmex-account',{error:'NETWORK',data:null});assert.equal(u.text('colmexEquity'),'—');assert.notEqual(u.get('colmexAccountHealth').dataset.state,'good');
 const old=fixture();old.data.observedAt=new Date(Date.now()-180001).toISOString();u.emit('levi:colmex-account',old);assert.equal(u.text('colmexCash'),'—');
 u.emit('levi:colmex-status-error');assert.notEqual(u.get('colmexServerHealth').dataset.state,'good');assert.match(u.text('colmexPositionCards'),/ממתין/);
});
test('an authenticated multi-account response without a selected account has no zero balances',()=>{
 const account=fixture();account.data.selectedAccount=null;account.data.selectionRequired=true;
 const u=ui({account});assert.equal(u.text('colmexSlotCount'),'—');assert.match(u.text('colmexAccountHealth'),/לבחור חשבון/);
});
