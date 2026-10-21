import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
class Element{constructor(tag='div'){this.tag=tag;this.children=[];this.textContent='';this.value='';this.hidden=false;this.disabled=false;this.listeners={};}append(...a){this.children.push(...a);}replaceChildren(...a){this.children=a;this.textContent='';}addEventListener(name,fn){this.listeners[name]=fn;}}
const snapshot={accounts:[{id:'42',name:'Demo',currency:'USD',type:'demo'}],selectedAccount:{id:'42',name:'Demo',currency:'USD',type:'demo'},state:{balance:1000},positions:[{instrumentName:'<img src=x>',side:'buy',qty:'2',avgPrice:'10',unrealizedPl:'1'}],observedAt:'2026-10-20T14:00:00Z',refreshAfterMs:30000};
function setup(){const nodes=new Map(),saved=new Map([['levi-colmex-account-view-v1','old-view-secret']]),calls=[],timers=new Set();let response={ok:true,status:200,json:async()=>snapshot};const context=vm.createContext({document:{getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},createElement:tag=>new Element(tag)},localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},URLSearchParams,AbortController,Date,Intl,Number,String,Object,Error,setTimeout:(fn,ms)=>{const id={fn,ms};timers.add(id);return id;},clearTimeout:id=>timers.delete(id),fetch:async(...args)=>{calls.push(args);return args[0].includes('action=status')?{ok:true,status:200,json:async()=>({version:2,credentialsConfigured:true,viewCodeRequired:false})}:response;}});vm.runInContext(fs.readFileSync(new URL('../colmex-account.js',import.meta.url),'utf8'),context);return {context,nodes,saved,calls,timers,setResponse:r=>response=r};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('background account read keeps the previous snapshot visible until its replacement arrives',async()=>{
 const r=setup();await flush();const before=r.nodes.get('brokerMetrics').children[0];let resolve;
 r.setResponse({ok:true,json:()=>new Promise(done=>{resolve=done;})});
 const pending=vm.runInContext('refresh()',r.context);await flush();assert.equal(r.nodes.get('brokerMetrics').children[0],before);assert.match(r.nodes.get('brokerAccountStatus').textContent,/מהקריאה הקודמת/);
 resolve(snapshot);await pending;assert.equal(r.nodes.get('brokerMetrics').children.length,7);assert.ok([...r.timers].some(t=>t.ms===60000));
});
test('account loads automatically with no viewer credential or authorization header, and deletes previous viewing key',async()=>{
 const r=setup();await flush();assert.equal(r.saved.size,0);assert.equal(r.nodes.get('brokerMetrics').children.length,7);assert.equal(r.calls.length,2);assert.equal(r.calls[1][1].headers,undefined);assert.equal(r.nodes.has('brokerViewForm'),false);
 const row=r.nodes.get('brokerPositions').children[0].children[1].children[0];assert.equal(row.children[0].textContent,'<img src=x>');assert.equal(row.children[0].children.length,0);
});
test('failed broker reads retain dated positions with a stale warning and authentication errors stop retries',async()=>{
 const r=setup();await flush();r.setResponse({ok:false,status:503,json:async()=>({error:'Connection unavailable',code:'AUTH_DENIED'})});await vm.runInContext('refresh()',r.context);assert.equal(r.nodes.get('brokerMetrics').children.length,7);assert.equal(r.nodes.get('brokerPositions').children.length,1);assert.match(r.nodes.get('brokerAccountStatus').textContent,/מהקריאה הקודמת/);assert.match(r.nodes.get('brokerConnectionBadge').textContent,/העדכון נכשל/);assert.equal(r.saved.size,0);assert.equal(r.timers.size,0);
});

test('open positions count and per-position P&L include the account currency',async()=>{const r=setup();await flush();assert.equal(r.nodes.get('brokerMetrics').children[6].children[1].textContent,'1');const row=r.nodes.get('brokerPositions').children[0].children[1].children[0];assert.equal(row.children[4].textContent,'1 USD');});
