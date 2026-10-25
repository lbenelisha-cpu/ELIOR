import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHandler} from '../netlify/functions/meitav-crawler.mjs';
import {validateSnapshot,connectionState,protectionLabel,reservedSymbols} from '../lib/crawler-view.mjs';
const token='1800000000.'+'a'.repeat(64);
const origin='https://dashboard.example';
function event(action,method='GET',body) {return {httpMethod:method,queryStringParameters:{action},headers:{host:'dashboard.example',origin,'content-type':'application/json',cookie:`unrelated=secret; __Secure-meitav_crawler=${token}`},...(body?{body:JSON.stringify(body)}:{})};}
const response=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
const snapshot=()=>({version:'2.1.2',mode:'paper',real_money:false,now:Date.now(),equity:54,day:{},settings:{},positions:[],orphans:[],pending:[],waiting:[],radar:[],events:[]});
test('unconfigured Meitav never calls an existing trading service',async()=>{
 let calls=0;const handler=createHandler({env:{BINANCE_API_BASE:'https://old.example',COLMEX_API_BASE:'https://old2.example'},fetcher:async()=>{calls++;throw Error();}});
 assert.equal(JSON.parse((await handler(event('config'))).body).configured,false);
 assert.equal((await handler(event('snapshot'))).statusCode,503);assert.equal(calls,0);
});
test('every trading mutation and unknown route is rejected without fetching',async()=>{
 let calls=0;const handler=createHandler({env:{CRAWLER_READONLY_URL:'https://bot.example'},fetcher:async()=>{calls++;throw Error();}});
 for(const action of ['close_all','close/BTCUSDT','kill','pause','resume','settings','settings/reset','telegram_test','__proto__','constructor','https://evil.test','../api/close_all']) {
  assert.equal((await handler(event(action,'POST',{}))).statusCode,404,action);
 }
 for(const action of ['state','snapshot','schema','health','config']) assert.equal((await handler(event(action,'POST',{}))).statusCode,405,action);
 assert.equal(calls,0);
});
test('only fixed HTTPS origin is accepted, with no fallback or query-driven URL',async()=>{
 for(const url of ['http://bot.example','file:///etc/passwd','https://user:secret@bot.example','https://bot.example/api','https://bot.example?x=1','https://bot.example#x']) {
  const h=createHandler({env:{CRAWLER_READONLY_URL:url},fetcher:async()=>assert.fail('must not fetch')});
  assert.equal(JSON.parse((await h(event('config'))).body).configured,false);
 }
});
test('snapshot forwards only crawler session and combines a verified heartbeat',async()=>{
 const calls=[];const handler=createHandler({env:{CRAWLER_READONLY_URL:'https://bot.example/'},fetcher:async(url,options)=>{calls.push({url,options});return response(url.endsWith('/health')?{ok:true,status:'running',tick_age_s:2}:snapshot());}});
 const e=event('snapshot');e.queryStringParameters.url='https://attacker.example';const result=await handler(e);assert.equal(result.statusCode,200);
 assert.deepEqual(calls.map(x=>x.url),['https://bot.example/api/state','https://bot.example/health']);
 for(const {options} of calls){assert.equal(options.headers.Cookie,`cc1_session=${token}`);assert.equal(options.redirect,'error');assert.ok(!JSON.stringify(options.headers).includes('unrelated'));assert.ok(!options.body);}
 const d=JSON.parse(result.body);assert.equal(d.health.ok,true);validateSnapshot(d.snapshot);
});
test('all private reads require a valid-looking session; login uses only PIN',async()=>{
 let calls=[];const handler=createHandler({env:{CRAWLER_READONLY_URL:'https://bot.example'},fetcher:async(url,options)=>{calls.push(options);return response({ok:true},200,{'set-cookie':`cc1_session=${token}; HttpOnly; Path=/; SameSite=strict`});}});
 for(const action of ['state','snapshot','schema','health']){const e=event(action);e.headers.cookie='other=x';assert.equal((await handler(e)).statusCode,401);}
 assert.equal(calls.length,0);
 const login=await handler(event('login','POST',{pin:'123456',url:'https://attacker.example',extra:'ignore'}));
 assert.equal(login.statusCode,200);assert.equal(calls[0].body,JSON.stringify({pin:'123456'}));assert.equal(calls[0].headers.Cookie,undefined);
 assert.match(login.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Strict/);assert.match(login.headers['Set-Cookie'],/Path=\/\.netlify\/functions\/meitav-crawler/);
 assert.ok(!login.body.includes(token));assert.ok(!login.body.includes('123456'));
});
test('login rejects cross-origin, form submissions, overlarge and malformed requests',async()=>{
 const h=createHandler({env:{CRAWLER_READONLY_URL:'https://bot.example'},fetcher:async()=>assert.fail('must not fetch')});
 let e=event('login','POST',{pin:'123456'});e.headers.origin='https://evil.example';assert.equal((await h(e)).statusCode,403);
 e=event('login','POST',{pin:'123456'});delete e.headers.origin;assert.equal((await h(e)).statusCode,403);
 e=event('login','POST',{pin:'123456'});e.headers['content-type']='text/plain';assert.equal((await h(e)).statusCode,415);
 for(const body of ['bad json',JSON.stringify({pin:'1'}),'x'.repeat(513)]){e=event('login','POST');e.body=body;assert.equal((await h(e)).statusCode,400);}
});
test('logout clears only the new view cookie and sends no upstream request',async()=>{
 const h=createHandler({env:{},fetcher:async()=>assert.fail('must not fetch')});const r=await h(event('logout','POST',{}));assert.equal(r.statusCode,200);assert.match(r.headers['Set-Cookie'],/Max-Age=0/);assert.doesNotMatch(r.headers['Set-Cookie'],/binance|colmex/);
});
test('missing health does not report a healthy engine; failure details are not leaked',async()=>{
 const h=createHandler({env:{CRAWLER_READONLY_URL:'https://bot.example'},fetcher:async url=>{if(url.endsWith('health'))throw Error('private credential');return response(snapshot());}});
 const r=JSON.parse((await h(event('snapshot'))).body);assert.equal(r.health.ok,false);
 const failed=createHandler({env:{CRAWLER_READONLY_URL:'https://bot.example'},fetcher:async()=>response({error:'token=secret'},500)});
 assert.doesNotMatch((await failed(event('snapshot'))).body,/secret|token/);
});
test('auth and throttling responses are retained without exposing the upstream error',async()=>{
 for(const status of [401,429]){const h=createHandler({env:{CRAWLER_READONLY_URL:'https://bot.example'},fetcher:async()=>response({detail:'sensitive'},status)});const r=await h(event('snapshot'));assert.equal(r.statusCode,status);assert.doesNotMatch(r.body,/sensitive/);}
});
test('health alone or old snapshots cannot make the connection green',()=>{
 const s=snapshot(), h={ok:true,tick_age_s:2};assert.equal(connectionState(s,h,100,200).current,true);
 assert.equal(connectionState(s,h,100,40_000).current,false);assert.equal(connectionState(s,{ok:true,tick_age_s:null},100,200).current,false);
 assert.equal(connectionState(s,{ok:true,tick_age_s:60},100,200).current,false);assert.equal(connectionState(null,h,100,200).current,false);
 s.mode='replay';s.now=1;assert.equal(connectionState(s,h,100,200).current,true);
});
test('snapshot rejects the old Spot service and inconsistent real-money claims',()=>{
 assert.throws(()=>validateSnapshot({connected:true,positions:[]}));const s=snapshot();s.mode='live';assert.throws(()=>validateSnapshot(s));s.real_money=true;assert.equal(validateSnapshot(s),s);
});
test('position protection requires quantity, order ID, price and no pending close',()=>{
 const p={qty:2,stop_qty:2,stop_id:'42',stop_price:90};assert.equal(protectionLabel(p),'פקודת הגנה רשומה במנוע');
 for(const patch of [{stop_qty:1},{stop_id:''},{stop_price:0},{qty:NaN}])assert.equal(protectionLabel({...p,...patch}),'הגנה דורשת בדיקה ביומן');
 assert.equal(protectionLabel({...p,close_reason:'daily limit'}),'סגירה בהמתנה לאישור');
});
test('capacity counts distinct symbols across pending and managed records',()=>{assert.equal(reservedSymbols({positions:[{symbol:'BTCUSDT'}],orphans:[{symbol:'ETHUSDT'}],pending:[{symbol:'BTCUSDT'}],waiting:[{symbol:'SOLUSDT'}]}),3);});
test('view imports no old trading engines or account storage; old stock lab is still available',()=>{
 const view=readFileSync(new URL('../meitav-agent.js',import.meta.url),'utf8');assert.doesNotMatch(view,/localStorage|sessionStorage|binance-control|colmex-|createPaper|runPaperCycle|\/api\/close|\/api\/settings/);
 const html=readFileSync(new URL('../meitav-agent.html',import.meta.url),'utf8');assert.match(html,/meitav-crawler\.css/);assert.doesNotMatch(html,/src="(?:binance|colmex)/);
 assert.match(readFileSync(new URL('../meitav-stock-lab.html',import.meta.url),'utf8'),/src="meitav-stock-lab\.js"/);
});
