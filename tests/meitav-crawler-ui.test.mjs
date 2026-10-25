import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as model from '../lib/crawler-view.mjs';
const html=readFileSync(new URL('../meitav-agent.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../meitav-agent.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/,'');
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
function harness(responder){
 const elements=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,{textContent:'',innerHTML:'',value:'',hidden:false,disabled:false,classes:new Set(),listeners:{},classList:{toggle(){}},addEventListener(name,fn){this.listeners[name]=fn;}}]));
 const calls=[],scheduled=[],listeners={},classes=new Set();let reloaded=false;
 const document={hidden:false,body:{classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);}}},getElementById(id){assert.ok(elements[id],`Missing element ${id}`);return elements[id];},addEventListener(name,fn){listeners[name]=fn;}};
 const context={...model,document,URL,Date,AbortSignal,console,location:{reload(){reloaded=true;}},setTimeout(fn){scheduled.push(fn);return fn;},clearTimeout(fn){const i=scheduled.indexOf(fn);if(i>=0)scheduled.splice(i,1);},fetch:async(url,options)=>{calls.push({url,options});const result=await responder(new URL(url,'https://dashboard.example').searchParams.get('action'),options);return {ok:result.status<400,status:result.status,json:async()=>result.body};}};
 vm.runInNewContext(js,context);
 return {elements,calls,scheduled,listeners,document,classes,get reloaded(){return reloaded;}};
}
const ok=body=>({status:200,body});
const config={configured:true,protocol:'crypto_crawler',readOnly:true};
const snapshot=()=>({version:'2.1.2',mode:'paper',real_money:false,now:Date.now(),equity:54,available:50,status:'watching',paused:false,day:{total:1,realized:.7,open:.3,target:2,loss_limit:2.16,fees:.1,date:'2026-10-26'},settings:{max_positions:5},positions:[],orphans:[],pending:[],waiting:[],radar:[],events:[],trades:[]});
test('missing connection leaves amounts unknown and does not schedule polling',async()=>{
 const h=harness(async()=>ok({...config,configured:false}));await flush();
 assert.equal(h.calls.length,1);assert.match(h.elements.connectionTitle.textContent,/ממתין לחיבור/);assert.equal(h.elements.equity.textContent,'');assert.equal(h.elements.loginForm.hidden,true);assert.equal(h.scheduled.length,0);
});
test('authenticated snapshot is rendered as paper, and escaped text never becomes markup',async()=>{
 const s=snapshot();s.radar=[{symbol:'<img onerror=x>',progress:.7,note:'<script>bad</script>'}];
 const h=harness(async action=>ok(action==='config'?config:{snapshot:s,health:{ok:true,tick_age_s:1}}));await flush();
 assert.match(h.elements.equity.textContent,/54/);assert.equal(h.elements.mode.textContent,'מחירים חיים · כסף מדומה');assert.equal(h.elements.connectPanel.hidden,true);assert.equal(h.scheduled.length,1);
 assert.match(h.elements.radar.innerHTML,/&lt;img/);assert.doesNotMatch(h.elements.radar.innerHTML,/<script>|<img/);
 assert.deepEqual(h.calls.map(x=>x.options.method),['GET','GET']);
});
test('failed refresh preserves last values but marks the view stale',async()=>{
 let count=0;const h=harness(async action=>action==='config'?ok(config):++count===1?ok({snapshot:snapshot(),health:{ok:true,tick_age_s:1}}):{status:502,body:{error:'disconnected'}});await flush();const previous=h.elements.equity.textContent;
 await h.elements.refresh.listeners.click();await flush();assert.equal(h.elements.equity.textContent,previous);assert.ok(h.classes.has('stale'));assert.equal(h.elements.notice.hidden,false);
});
test('failed login clears the PIN and sends only the dedicated login request',async()=>{
 const h=harness(async action=>action==='config'?ok(config):{status:401,body:{error:'wrong PIN'}});await flush();
 h.elements.pin.value='123456';const button={disabled:false};await h.elements.loginForm.listeners.submit({preventDefault(){},submitter:button});
 assert.equal(h.elements.pin.value,'');assert.equal(h.elements.loginError.textContent,'wrong PIN');assert.equal(button.disabled,false);assert.equal(h.calls.at(-1).url,'/.netlify/functions/meitav-crawler?action=login');
});
test('hidden tab stops polling; logout uses only view disconnect',async()=>{
 const h=harness(async action=>ok(action==='config'?config:action==='logout'?{ok:true}:{snapshot:snapshot(),health:{ok:true,tick_age_s:1}}));await flush();
 h.document.hidden=true;h.listeners.visibilitychange();assert.equal(h.scheduled.length,0);
 await h.elements.logout.listeners.click();assert.equal(h.reloaded,true);assert.equal(h.calls.at(-1).url,'/.netlify/functions/meitav-crawler?action=logout');
});
test('foreign service data is rejected before any account figures render',async()=>{
 const h=harness(async action=>ok(action==='config'?config:{snapshot:{equity:99999},health:{ok:true,tick_age_s:1}}));await flush();
 assert.equal(h.elements.equity.textContent,'');assert.equal(h.elements.notice.hidden,false);assert.match(h.elements.notice.textContent,/תואמים/);
});
test('real Python 2.1.2 engine snapshot contract renders its simulated position',async()=>{
 const s=JSON.parse(readFileSync(new URL('./fixtures/crawler-212.json',import.meta.url),'utf8'));
 const h=harness(async action=>ok(action==='config'?config:{snapshot:s,health:{ok:true,tick_age_s:1}}));await flush();
 assert.equal(s.version,'2.1.2');assert.equal(s.positions.length,1);assert.match(h.elements.positions.innerHTML,/SOLUSDT/);assert.match(h.elements.positions.innerHTML,/פקודת הגנה רשומה במנוע/);assert.equal(h.elements.notice.hidden,true);
});
