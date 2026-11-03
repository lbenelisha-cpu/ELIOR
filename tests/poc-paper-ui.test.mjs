import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const now=Date.UTC(2026,10,3,12),flush=()=>new Promise(r=>setImmediate(r));
function fixture(read){const nodes=[];function el(tag){const n={tag,textContent:'',children:[],events:{},append(...xs){this.children.push(...xs);},replaceChildren(...xs){this.children=xs;},setAttribute(k,v){this[k]=v;},addEventListener(k,fn){this.events[k]=fn;}};nodes.push(n);return n;}const context=vm.createContext({document:{createElement:el},Date,Number,Intl,Error});const code=fs.readFileSync(new URL('../binance-poc-paper.js',import.meta.url),'utf8').split("const host=document.getElementById('pocPaperPanel');")[0].replaceAll('export function','function');vm.runInContext(code,context);const host=el('section'),panel=context.createPocPaperPanel(host,{read,now:()=>now});const text=n=>n.textContent+n.children.map(text).join('|');return {panel,nodes,text:()=>text(host),context};}
const account={side:'LONG',live:{equity:150,free:30,at:now},seed:150,startedAt:now,realized:0,openPnl:null,equity:null,totalPnl:null,pct:null,closedCount:0,positions:[],pending:[],closed:[],daily:[]};
const data={ok:true,version:'POC_PAPER_V1',executionEnabled:false,lastCycle:now,policy:{trailingPct:1,roundTripFeePct:.1},accounts:[account,{side:'SHORT',status:'WAIT_BALANCE',live:null}],issues:[]};
test('table distinguishes real balance, frozen baseline, open/closed demo and missing SHORT',async()=>{
 const f=fixture(async()=>data);f.panel.setConnected(true);await flush();assert.match(f.text(),/150.00/);assert.match(f.text(),/30.00/);assert.match(f.text(),/טרם נקבע סכום פתיחה/);assert.match(f.text(),/רווח פתוח/);assert.match(f.text(),/1%/);assert.match(f.text(),/כל 5 שניות/);assert.match(f.text(),/מימון SHORT/);
 f.panel.setConnected(false);assert.doesNotMatch(f.text(),/150.00/);
});
test('failed read clears previous balances, install-required is explicit and refresh survives',async()=>{
 let calls=0;const f=fixture(async()=>{if(calls++)throw Object.assign(Error('missing'),{status:404});return data;});f.panel.setConnected(true);await flush();await f.panel.load();assert.doesNotMatch(f.text(),/150.00/);assert.match(f.text(),/עדיין לא הותקן/);
});
test('late response after disconnect cannot restore financial data; CSV and HTML text are safe',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>resolve=r));f.panel.setConnected(true);f.panel.setConnected(false);resolve(data);await flush();assert.doesNotMatch(f.text(),/150.00/);
 const csv=f.context.paperCsv({...data,accounts:[{side:'LONG',positions:[{symbol:'=DANGER',entryAt:now,entry:1,mark:2,qty:1,net:1}]}]});assert.match(csv,/'=DANGER/);assert.ok(f.nodes.every(n=>!Object.hasOwn(n,'innerHTML')));
});
test('private GET endpoint is authorized before dispatch; browser proxy allows only the read route',async()=>{
 const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');const auth=source.indexOf('if(protectedControl&&!authorized)');assert.ok(auth>=0);assert.ok(source.indexOf("if(u.pathname==='/api/binance-poc-paper'")>auth);
 const {readTarget}=await import('../netlify/functions/binance-read-proxy.mjs');assert.equal(readTarget('/api/binance-poc-paper').pathname,'/api/binance-poc-paper');assert.throws(()=>readTarget('/api/binance-poc-paper?reset=true'));
 for(const file of ['poc-paper-service.mjs','poc-paper-ledger.mjs','poc-paper-strategy.mjs']){const content=fs.readFileSync(new URL('../lib/'+file,import.meta.url),'utf8');assert.doesNotMatch(content,/\.post\(|\.del\(|placeLive|enterPoc|executeManualTrade/);}
});
