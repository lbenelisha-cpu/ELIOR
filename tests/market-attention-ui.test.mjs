import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attributes={};this.value='';this.open=false;this.className='';this.text='';}
 set textContent(v){this.text=String(v);this.children=[];}get textContent(){return this.text+this.children.map(x=>x.textContent).join(' ');}
 set innerHTML(v){throw Error('HTML injection boundary used');}
 append(el){this.children.push(el);}replaceChildren(...els){this.text='';this.children=els;}setAttribute(k,v){this.attributes[k]=v;}
 querySelectorAll(selector){return this.findAll(e=>selector==='details[open]'&&e.tag==='details'&&e.open);}
 findAll(test){return this.children.flatMap(x=>[...(test(x)?[x]:[]),...x.findAll(test)]);}
}
function ui(){
 const panel=new Element('section'),listeners={},timers=[],h={now:1793707201000};
 const context={document:{getElementById:id=>id==='marketAttentionPanel'?panel:null,createElement:tag=>new Element(tag),hidden:false,addEventListener:(name,fn)=>listeners[name]=fn},window:{addEventListener:(name,fn)=>listeners[name]=fn,dispatchEvent:e=>{h.lastEvent=e;listeners[e.type]?.(e);}},CustomEvent:class{constructor(type,args){this.type=type;this.detail=args?.detail;}},Date:class extends Date{static now(){return h.now;}},URL,setInterval:fn=>timers.push(fn)};
 vm.runInNewContext(fs.readFileSync(new URL('../market-attention.js',import.meta.url),'utf8'),context);
 return {...h,panel,timers,clock:h,send:s=>listeners['levi:binance-agent']({detail:{marketAttention:s}}),expire:()=>listeners['trade-device-expired'](),find:fn=>panel.findAll(fn),context};
}
const snapshot=now=>({policy:{version:'MARKET_ATTENTION_V1'},checkedAt:now,rows:[{symbol:'ETHUSDT',news:{active:true,covered:true,expiresAt:now+600000,evidence:[{title:'<img src=x onerror=alert(1)>',url:'https://www.coindesk.com/news/example',source:'CoinDesk',publishedAt:now-60000,firstSeenAt:now-30000,checkedAt:now,verification:'SINGLE_REPORT'}]},technical:{ready:true,watch:true,reason:'NEAR_CHANNEL_BOUNDARY',checkedAt:now,dataAt:now-1000,expiresAt:now+180000,channel:{highTouches:2,lowTouches:2,confirmed:true},regression:{side:'UP'},volume:{ratio:1.4},missing:['VOLUME_RATIO']}}],sourceStatus:[],events:[]});
test('attention display uses text nodes, validates links, expires highlights and clears on auth loss',()=>{
 const h=ui(),s=snapshot(h.clock.now);h.send(s);
 assert.equal(h.find(e=>e.className.includes('attention-active')).length,1);assert.match(h.panel.textContent,/2 נגיעות למעלה/);assert.match(h.panel.textContent,/<img src=x/);assert.equal(h.find(e=>e.tag==='img').length,0);
 h.find(e=>e.tag==='button'&&e.text==='פתח גרף')[0].onclick();assert.equal(h.clock.lastEvent.detail,'ETHUSDT');assert.equal(h.clock.lastEvent.type,'levi-rsi-select');
 s.rows[0].news.evidence[0].url='javascript:alert(1)';h.send(s);assert.equal(h.find(e=>e.href?.startsWith('javascript:')).length,0);
 h.clock.now+=90001;h.timers[0]();assert.equal(h.find(e=>e.className.includes('attention-active')).length,0);assert.match(h.panel.textContent,/התיישן/);
 h.expire();assert.equal(h.find(e=>e.className==='attention-card').length,0);assert.match(h.panel.textContent,/חבר את המכשיר/);
 assert.equal(h.context.fetch,undefined);
});
test('observer TTL is independent of live transport and selection/filter controls remain read-only',()=>{
 const h=ui(),s=snapshot(h.clock.now);s.rows[0].news.active=false;s.rows[0].technical.expiresAt=h.clock.now-1;h.send(s);
 h.find(e=>e.tag==='button'&&e.text==='הצג את כל הנכסים')[0].onclick();assert.match(h.panel.textContent,/התצפית התיישנה/);assert.equal(h.find(e=>e.className.includes('attention-active')).length,0);
 const search=h.find(e=>e.tag==='input')[0];search.value='BTC';search.oninput();assert.match(h.panel.textContent,/אין נכס תואם/);
 assert.doesNotMatch(fs.readFileSync(new URL('../market-attention.js',import.meta.url),'utf8'),/\bfetch\s*\(|XMLHttpRequest|\.write\(|innerHTML\s*=/);
 assert.match(fs.readFileSync(new URL('../market-attention.css',import.meta.url),'utf8'),/prefers-reduced-motion:reduce/);
});
test('news brief receives the source report while trading observations stay unchanged',()=>{
 const h=ui(),seen=[],s=snapshot(h.clock.now),original=JSON.stringify(s);
 h.context.window.LEVI_NEWS_SUMMARY={append:(parent,row)=>{seen.push(row);const text=new Element('p');text.textContent='תקציר בעברית';parent.append(text);}};
 h.send(s);assert.equal(seen.length,2);assert.equal(seen[0],s.rows[0].news.evidence[0]);assert.match(h.panel.textContent,/תקציר בעברית/);assert.equal(JSON.stringify(s),original);
});
test('shared cards show both directions, mapped contract and separate execution blockers',()=>{
 const h=ui(),s=snapshot(h.clock.now);s.sharedWatchPolicy={version:'SHARED_LONG_SHORT_WATCH_V1'};
 const row=s.rows[0];row.symbol='GOOGLBUSDT';row.longDecision={at:h.clock.now,reason:'WAIT_CHANNEL_LIVE_BREAKOUT'};row.entryBlockers={long:'NO_FREE_SLOT',short:'FUTURES_ENTRIES_PAUSED'};row.shortObservation={available:true,futuresSymbol:'GOOGLUSDT',at:h.clock.now,expiresAt:h.clock.now+60000,reason:'SHORT_VOLUME_LOW'};
 h.send(s);assert.match(h.panel.textContent,/LONG · GOOGLBUSDT/);assert.match(h.panel.textContent,/SHORT · GOOGLUSDT/);assert.match(h.panel.textContent,/NO_FREE_SLOT/);assert.match(h.panel.textContent,/SHORT_VOLUME_LOW/);assert.match(h.panel.textContent,/FUTURES_ENTRIES_PAUSED/);
 row.shortObservation={available:false,mappingReason:'FUTURES_SYMBOL_UNAVAILABLE',at:null};h.send(s);assert.match(h.panel.textContent,/FUTURES_SYMBOL_UNAVAILABLE/);assert.doesNotMatch(h.panel.textContent,/SHORT · GOOGLUSDT/);
});
