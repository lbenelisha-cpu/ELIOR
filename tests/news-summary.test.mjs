import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script=fs.readFileSync(new URL('../news-summary.js',import.meta.url),'utf8');
const now=1793952000000,KEY='levi-news-he-brief-v1';
const report={title:'Bitcoin may fall 5% after ETF outflows',url:'https://cointelegraph.com/news/public-story',account:'NEVER_SEND',token:'NEVER_SEND'};
const translated='ביטקוין עלול לרדת ב־5% בעקבות יציאת כספים מקרנות סל';
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attributes={};this.text='';this.isConnected=true;this.classes=new Set();this.classList={add:v=>this.classes.add(v),toggle:v=>{if(this.classes.has(v)){this.classes.delete(v);return false;}this.classes.add(v);return true;}};}
 set textContent(v){this.text=String(v);this.children=[];}get textContent(){return this.text+this.children.map(e=>e.textContent).join(' ');}
 set innerHTML(v){throw Error('Unsafe HTML rendering');}
 append(el){this.children.push(el);}setAttribute(k,v){this.attributes[k]=v;}
}
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function setup({fetchImpl,store=new Map(),observe=false,clock={now}}={}){
 const calls=[],observers=[];
 const context={window:{},document:{createElement:tag=>new Element(tag)},URL,TextEncoder,AbortSignal,
  Date:class extends Date{static now(){return clock.now;}},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},
  fetch:async(url,options)=>{calls.push({url,options});return fetchImpl?fetchImpl(url,options):{ok:true,json:async()=>({responseStatus:200,responseData:{translatedText:translated}})};}};
 if(observe)context.IntersectionObserver=class{constructor(fn){this.fn=fn;observers.push(this);}observe(node){this.node=node;}disconnect(){this.disconnected=true;}};
 vm.runInNewContext(script,context);
 const parent=new Element('section'),api=context.window.LEVI_NEWS_SUMMARY;
 return {append:(row=report)=>api.append(parent,row),parent,calls,store,observers,clock};
}
test('translates the complete public headline only, deduplicates renders and retains a Hebrew cache across reloads',async()=>{
 const h=setup(),first=h.append(),second=h.append({...report,id:'same headline elsewhere'});await flush();
 assert.equal(h.calls.length,1);const {url,options}=h.calls[0],u=new URL(url);
 assert.equal(u.origin,'https://api.mymemory.translated.net');assert.equal(u.pathname,'/get');
 assert.equal(u.searchParams.get('q'),report.title);assert.equal(u.searchParams.get('langpair'),'autodetect|he');assert.equal([...u.searchParams.keys()].length,2);
 assert.doesNotMatch(url,/NEVER_SEND|account|token/);assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.redirect,'error');
 for(const node of [first,second]){assert.equal(node.dataset.state,'ready');assert.match(node.textContent,/עלול לרדת ב־5%/);assert.equal(node.dir,'rtl');assert.equal(node.lang,'he');}
 const reloaded=setup({store:h.store}),cached=reloaded.append();await flush();assert.equal(reloaded.calls.length,0);assert.match(cached.textContent,/יציאת כספים/);
});
test('failure and quota responses stay explicit, never become a Hebrew brief and do not loop on polling',async()=>{
 for(const reply of [{responseStatus:429,quotaFinished:true,responseData:{translatedText:'LIMIT'}},{responseStatus:200,responseData:{translatedText:'English unchanged'}},{responseStatus:200,responseData:{translatedText:'<img onerror=alert(1)>כותרת'}}]){
  const h=setup({fetchImpl:async()=>({ok:true,json:async()=>reply})});const row=h.append();await flush();
  assert.equal(row.dataset.state,'unavailable');assert.doesNotMatch(row.textContent,/English unchanged|onerror/);
  for(let i=0;i<20;i++)h.append();await flush();assert.equal(h.calls.length,1);
  if(reply.quotaFinished){const other=h.append({...report,title:'Ethereum report'});await flush();assert.equal(h.calls.length,1);assert.match(other.textContent,/מכסת התרגום/);}
 }
 const h=setup({fetchImpl:async()=>{throw Error('network down');}}),row=h.append();await flush();assert.equal(row.dataset.state,'unavailable');assert.match(row.textContent,/הכותרת המקורית/);
});
test('rejects unsafe sources and oversized UTF-8 headlines without truncating or sending anything',async()=>{
 const h=setup();
 for(const url of ['javascript:alert(1)','https://cointelegraph.com.evil.example/x','https://user@cointelegraph.com/x','https://cointelegraph.com:123/x','http://cointelegraph.com/x'])assert.equal(h.append({...report,url}),null);
 for(const title of ['','x'.repeat(401),'é'.repeat(251)])assert.equal(h.append({...report,title}),null);
 await flush();assert.equal(h.calls.length,0);
 const hebrew=h.append({...report,title:'ביטקוין עלול לרדת בחמישה אחוזים'});assert.match(hebrew.textContent,/כותרת המקור/);assert.equal(h.calls.length,0);
});
test('visible stories alone request translations and at most two requests run simultaneously',async()=>{
 const waiting=[],h=setup({observe:true,fetchImpl:()=>new Promise(resolve=>waiting.push(resolve))});
 for(let i=0;i<5;i++)h.append({...report,title:`Bitcoin report ${i}`});assert.equal(h.calls.length,0);
 for(const o of h.observers)o.fn([{isIntersecting:true}]);assert.equal(h.calls.length,2);
 const response={ok:true,json:async()=>({responseStatus:200,responseData:{translatedText:translated}})};
 waiting.shift()(response);await flush();assert.equal(h.calls.length,3);
 while(waiting.length){waiting.shift()(response);await flush();}assert.equal(h.calls.length,5);
 const removed=h.append({...report,title:'Removed story'}),o=h.observers.at(-1);removed.isConnected=false;o.fn([{isIntersecting:true}]);assert.equal(h.calls.length,5);assert.equal(o.disconnected,true);
});
test('restored rolling budget limits requests and expired translations cannot mask changed headlines',async()=>{
 const store=new Map([[KEY,JSON.stringify({version:'NEWS_HE_BRIEF_V1',cache:[[report.title,{text:translated,at:now-8*86400000}]],charges:Array.from({length:10},()=>({at:now-1000,count:500}))})]]);
 const h=setup({store}),row=h.append();await flush();assert.equal(h.calls.length,0);assert.equal(row.dataset.state,'unavailable');
 h.clock.now+=86400001;const reload=setup({store,clock:h.clock});reload.append();await flush();assert.equal(reload.calls.length,1);
 reload.append({...report,title:'Bitcoin will not fall 5% after ETF inflows'});await flush();assert.equal(reload.calls.length,2);
});
test('malformed storage is tolerated and long translated headlines can be expanded without dropping words',async()=>{
 const long='לפי הדיווח החברה עשויה לשנות את התוכנית אך עדיין לא התקבלה החלטה סופית. '.repeat(4);
 const store=new Map([[KEY,JSON.stringify({version:'NEWS_HE_BRIEF_V1',cache:[null,['bad',{}]],charges:[null,{},'bad']})]]);
 const h=setup({store,fetchImpl:async()=>({ok:true,json:async()=>({responseStatus:200,responseData:{translatedText:long}})})}),row=h.append();await flush();
 assert.equal(row.dataset.state,'ready');assert.match(row.textContent,/עדיין לא התקבלה החלטה סופית/);
 const button=row.children.find(e=>e.tag==='button');assert.equal(button.attributes['aria-expanded'],'false');button.onclick();assert.equal(button.attributes['aria-expanded'],'true');
 assert.equal(row.children[0].textContent,long.trim());
});
