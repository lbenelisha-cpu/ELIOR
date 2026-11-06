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
 vm.runInNewContext(fs.readFileSync(new URL('../channel-entry-checklist.js',import.meta.url),'utf8'),context);
 vm.runInNewContext(fs.readFileSync(new URL('../market-attention.js',import.meta.url),'utf8'),context);
 return {...h,panel,timers,clock:h,send:(s,config)=>listeners['levi:binance-agent']({detail:{marketAttention:s,config}}),expire:()=>listeners['trade-device-expired'](),find:fn=>panel.findAll(fn),context};
}
const snapshot=now=>({policy:{version:'MARKET_ATTENTION_V1'},checkedAt:now,rows:[{symbol:'ETHUSDT',news:{active:true,covered:true,expiresAt:now+600000,evidence:[{title:'<img src=x onerror=alert(1)>',url:'https://www.coindesk.com/news/example',source:'CoinDesk',publishedAt:now-60000,firstSeenAt:now-30000,checkedAt:now,verification:'SINGLE_REPORT'}]},technical:{ready:true,watch:true,reason:'NEAR_CHANNEL_BOUNDARY',checkedAt:now,dataAt:now-1000,expiresAt:now+180000,channel:{highTouches:2,lowTouches:2,confirmed:true},regression:{side:'UP'},volume:{ratio:1.4},missing:['VOLUME_RATIO']}}],sourceStatus:[],events:[]});
test('attention display uses text nodes, validates links, expires highlights and clears on auth loss',()=>{
 const h=ui(),s=snapshot(h.clock.now);h.send(s);
 assert.equal(h.find(e=>e.className.includes('attention-active')).length,1);assert.match(h.panel.textContent,/2 נגיעות למעלה/);assert.match(h.panel.textContent,/<img src=x/);assert.equal(h.find(e=>e.tag==='img').length,0);
 h.find(e=>e.tag==='button'&&e.text==='פתח גרף Spot')[0].onclick();assert.equal(h.clock.lastEvent.detail,'ETHUSDT');assert.equal(h.clock.lastEvent.type,'levi-dashboard-select');
 // Exercise the real dashboard navigation from a hidden, collapsed chart.
 const agent=fs.readFileSync(new URL('../binance-agent.js',import.meta.url),'utf8');
 const chart={hidden:true,open:false,classList:{contains:name=>name==='trade-view'},scrollIntoView:options=>{h.clock.scroll=options;}};
 const portfolio={hidden:false,classList:{contains:name=>name==='portfolio-view'}};
 Object.assign(h.context,{activeView:'portfolio',selectedSymbol:'BTCUSDT',currentAgentData:{agents:[{symbol:'ETHUSDT'}]},currentMode:'live',currentLiveAccount:{},chartCandles:[],
  $:selector=>selector==='#chartSection'?chart:null,requestAnimationFrame:fn=>fn(),drawCandles:()=>{},
  updateSelectedAsset:()=>{h.clock.chartSymbol=h.context.selectedSymbol;}});
 const get=h.context.document.getElementById;
 h.context.document.getElementById=id=>id==='chartSection'?chart:get(id);
 h.context.document.querySelectorAll=selector=>selector==='.app-view'?[chart,portfolio]:[];
 const view=agent.slice(agent.indexOf('function setDashboardView('),agent.indexOf('\nasync function J('));
 const select=agent.slice(agent.indexOf('function selectScannerAsset('),agent.indexOf('\nfunction render(d,'));
 const listener=agent.match(/window\.addEventListener\('levi-dashboard-select',event=>\{[\s\S]*?\n\}\);/)[0];
 vm.runInNewContext(view+'\n'+select+'\n'+listener,h.context);
 h.find(e=>e.tag==='button'&&e.text==='פתח גרף Spot')[0].onclick();
 assert.equal(h.context.activeView,'trade');assert.equal(chart.hidden,false);assert.equal(chart.open,true);assert.equal(portfolio.hidden,true);
 assert.equal(h.clock.chartSymbol,'ETHUSDT');assert.equal(h.clock.scroll.block,'start');assert.equal(h.clock.scroll.behavior,'smooth');
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

test('entry checklists show recorded passes per market, never closed-bar volume or final execution approval',()=>{
 const h=ui(),s=snapshot(h.clock.now),row=s.rows[0];s.mode='live';s.sharedWatchPolicy={version:'SHARED_LONG_SHORT_WATCH_V1'};
 const config={channelPrimary:{requested:true,version:'CHANNEL_PRIMARY_INTRABAR_V2',period:50,minVolumeRatio:1.5,minMeanDollarVolume:10000,consolidationPolicy:{version:'CHANNEL_CONSOLIDATION_V1'}}};
 row.longDecision={at:h.clock.now,reason:'CHANNEL_VOLUME_LOW'};
 row.shortObservation={available:true,observationOnly:true,spotSymbol:row.symbol,futuresSymbol:'ETHUSDT',at:h.clock.now,expiresAt:h.clock.now+60000,reason:'WAIT_TWO_TOUCHES_PER_SIDE'};
 row.technical.volume={ratio:9,ratioPassed:true};row.entryBlockers={long:'NO_FREE_SLOT'};
 const original=JSON.stringify(s),checks=()=>h.find(e=>e.className==='attention-checklist');
 const condition=(index,id)=>checks()[index].findAll(e=>e.dataset.condition===id)[0];
 h.send(s,config);assert.equal(checks().length,2);
 assert.equal(h.find(e=>e.dataset.condition==='data').length,0);
 assert.doesNotMatch(h.panel.textContent,/50 נרות סגורים ורציפים \+ מחיר ונר פתוח עדכניים/);
 assert.equal(condition(0,'channel').dataset.state,'passed');assert.match(condition(0,'channel').textContent,/✓/);
 assert.equal(condition(0,'volume').dataset.state,'waiting');assert.equal(condition(0,'range').dataset.state,'unknown');
 assert.equal(condition(0,'execution').dataset.state,'blocked');assert.equal(condition(1,'channel').dataset.state,'waiting');
 assert.equal(condition(1,'slope').dataset.state,'unknown');assert.equal(JSON.stringify(s),original);
 assert.match(h.panel.textContent,/הבדיקה נעצרת בתנאי הראשון/);
 // A fresh envelope cannot revive the previous candle's successful evidence.
 h.clock.now=Math.ceil(h.clock.now/300000)*300000;s.checkedAt=h.clock.now;
 h.send(s,config);assert.equal(h.find(e=>e.dataset.state==='passed').length,0);
 assert.match(h.panel.textContent,/תנאי כניסה בתעלה · ממתין לעדכון נתונים/);
 assert.doesNotMatch(h.panel.textContent,/0\/10 אושרו בבדיקה/);
 row.longDecision={at:h.clock.now,reason:'WAIT_CHANNEL_LIVE_BAR'};
 h.send(s,config);assert.match(h.panel.textContent,/ממתין לעדכון נתונים/);assert.doesNotMatch(h.panel.textContent,/0\/10 אושרו בבדיקה/);
 // Unknown policy and unmapped Futures must not inherit favorable Spot observations.
 row.longDecision.at=h.clock.now;row.shortObservation.available=false;row.shortObservation.mappingReason='FUTURES_SYMBOL_UNAVAILABLE';
 h.send(s,{channelPrimary:{...config.channelPrimary,version:'OTHER'}});assert.equal(h.find(e=>e.dataset.state==='passed').length,0);
 h.clock.now+=90001;h.timers[0]();assert.equal(h.find(e=>e.dataset.state==='blocked').length,0);
 h.expire();assert.equal(checks().length,0);
});

test('a pending candle update preserves the previous touch check and count with explicit historical labels',()=>{
 const h=ui();h.clock.now=Math.ceil(h.clock.now/300000)*300000-1000;
 const s=snapshot(h.clock.now),row=s.rows[0];s.mode='live';s.sharedWatchPolicy={version:'SHARED_LONG_SHORT_WATCH_V1'};
 const config={channelPrimary:{requested:true,version:'CHANNEL_PRIMARY_INTRABAR_V2',period:50,minVolumeRatio:1.5,minMeanDollarVolume:10000,consolidationPolicy:{version:'CHANNEL_CONSOLIDATION_V1'}}};
 row.longDecision={at:h.clock.now,reason:'WAIT_CHANNEL_LIVE_BREAKOUT'};
 row.shortObservation={available:true,observationOnly:true,spotSymbol:row.symbol,futuresSymbol:row.symbol,at:h.clock.now,expiresAt:h.clock.now+1000,reason:'SHORT_VOLUME_LOW'};
 h.send(s,config);assert.equal(h.find(e=>e.dataset.condition==='channel'&&e.dataset.state==='passed').length,2);
 h.clock.now+=1000;s.checkedAt=h.clock.now;row.shortObservation.reason='STALE_SHORT_OBSERVATION';row.shortObservation.expiresAt=null;
 h.send(s,config);
 assert.equal(h.find(e=>e.dataset.state==='passed').length,0);
 const prior=h.find(e=>e.dataset.condition==='channel'&&e.dataset.state==='previous_passed');assert.equal(prior.length,2);
 for(const p of prior){assert.match(p.textContent,/✓/);assert.match(p.textContent,/אושר בבדיקה הקודמת · מתעדכן/);}
 assert.match(h.panel.textContent,/2\/10 בבדיקה האחרונה · ממתין לעדכון/);
 assert.match(h.panel.textContent,/4\/10 בבדיקה האחרונה · ממתין לעדכון/);
 assert.match(h.panel.textContent,/הסימונים הקודמים אינם אישור כניסה כעת/);
 row.longDecision={at:h.clock.now,reason:'WAIT_CHANNEL_LIVE_BAR'};h.send(s,config);
 assert.equal(h.find(e=>e.dataset.condition==='channel'&&e.dataset.state==='previous_passed').length,2);
 row.longDecision={at:h.clock.now+1,reason:'WAIT_CHANNEL_TWO_TOUCHES'};h.clock.now++;s.checkedAt=h.clock.now;h.send(s,config);
 assert.equal(h.find(e=>e.dataset.condition==='channel'&&e.dataset.state==='waiting').length,1);
 assert.equal(h.find(e=>e.dataset.condition==='channel'&&e.dataset.state==='previous_passed').length,1);
 h.expire();h.send(s,config);assert.equal(h.find(e=>e.dataset.state?.startsWith('previous_')).length,0);
});
