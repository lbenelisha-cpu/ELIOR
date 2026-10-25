import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {binanceTradeEvents,binanceSignalEvents,pairedDevice,deliverBinanceEvents,pollBinanceNotifications} from '../push/binance-monitor.mjs';
const now=Date.parse('2026-10-17T08:30:00Z'),at=new Date(now-60000).toISOString(),subscription={endpoint:'https://web.push.apple.com/device',keys:{p256dh:'x',auth:'y'}};
const fill={type:'BUY',symbol:'UNIUSDT',price:7.5,amountUsdt:28.7,orderId:123,status:'FILLED',at};
function memory(){const data=new Map();let etag=0;return {data,getWithMetadata:async key=>data.has(key)?{data:data.get(key).data,etag:data.get(key).etag}:null,setJSON:async(key,value,options={})=>{if(options.onlyIfNew&&data.has(key)||options.onlyIfMatch&&data.get(key)?.etag!==options.onlyIfMatch)return {modified:false};data.set(key,{data:structuredClone(value),etag:String(++etag)});return {modified:true};},delete:async key=>data.delete(key)};}
const device=()=>({...pairedDevice(subscription,{topics:['binance-trades']},null,now-120000),key:'device-0'});
test('only actual filled LIVE trades alert, correct net zero is shown and missing fees stay unknown',()=>{
 const sell={...fill,type:'SELL'},snapshot={live:[fill,sell,{...fill,status:'REJECTED'},{...fill,at:new Date(now-700000).toISOString()},{...fill,at:new Date(now+1).toISOString()}],demo:[fill],netJournal:{live:[{symbol:fill.symbol,at,netPnlUsdt:0}]}};
 const events=binanceTradeEvents(snapshot,now);assert.equal(events.length,2);assert.match(events[0].notification.title,/קנייה בוצעה/);assert.match(events[1].notification.body,/נטו \+0/);assert.equal(events[0].notification.url,'/binance-agent.html');assert.doesNotMatch(JSON.stringify(events),/keys|account|secret/);
 assert.match(binanceTradeEvents({live:[sell]},now)[0].notification.body,/אינו זמין/);
});
test('signals need a fresh confirmed pattern, are not fills and retain one identity across repeated checks',()=>{
 const a={symbol:'UNIUSDT',position:'CASH',entryConfirmed:true,strategy:{patternId:'p',signalTime:now-60000}};
 const snapshot={mode:'live',agents:[a,{...a,position:'LONG'},{...a,staleData:true},{...a,entryConfirmed:false}]};const events=binanceSignalEvents(snapshot,now);assert.equal(events.length,1);assert.match(events[0].notification.body,/אינה הודעת ביצוע/);assert.equal(events[0].id,binanceSignalEvents(snapshot,now+60000)[0].id);assert.equal(binanceSignalEvents({...snapshot,mode:'demo'},now).length,0);
});
test('pairing opts in explicitly, preserves chosen-topic start and resets it when enabled later',()=>{
 const old={subscription};const d=pairedDevice(subscription,{topics:['binance-trades']},old,now);assert.equal(d['binance-trades-since'],now);assert.deepEqual(pairedDevice(subscription,{topics:['binance-trades']},d,now+1).topics,['binance-trades']);assert.equal(pairedDevice(subscription,{topics:['binance-trades']},d,now+1)['binance-trades-since'],now);assert.throws(()=>pairedDevice(subscription,{topics:[]},null,now));assert.throws(()=>pairedDevice(subscription,{topics:['all']},null,now));
});
test('deduplication survives polls, no old-fill flood, transient failures retry only unsuccessful devices',async()=>{
 const store=memory(),events=binanceTradeEvents({live:[fill]},now),a=device(),b={...device(),key:'device-1',subscription:{...subscription,endpoint:subscription.endpoint+'2'}},newDevice=pairedDevice(subscription,{topics:['binance-trades']},null,now);let failed=true,calls=[];
 const send=async s=>{calls.push(s.endpoint);if(s.endpoint.endsWith('2')&&failed)throw Error('Temporary');};
 const args={events,devices:[a,b],store,send,remove:async()=>{},now};let r=await deliverBinanceEvents(args);assert.equal(r.accepted,1);assert.equal(r.failed,1);failed=false;r=await deliverBinanceEvents(args);assert.equal(r.accepted,1);assert.equal(r.duplicates,1);assert.equal(calls.filter(x=>x===subscription.endpoint).length,1);
 r=await deliverBinanceEvents({...args,devices:[newDevice]});assert.equal(r.accepted,0);
});
test('expired device is removed and overlapping deliveries claim each event once',async()=>{
 const store=memory(),args={events:binanceTradeEvents({live:[fill]},now),devices:[device()],store,now};let sends=0;const send=async()=>{sends++;};await Promise.all([deliverBinanceEvents({...args,send,remove:async()=>{}}),deliverBinanceEvents({...args,send,remove:async()=>{}})]);assert.equal(sends,1);
 let removed=[];const result=await deliverBinanceEvents({...args,store:memory(),send:async()=>{throw {statusCode:410};},remove:async k=>removed.push(k)});assert.equal(result.expired,1);assert.deepEqual(removed,['device-0']);
});
test('cloud polling uses authenticated GET only, runs without browser, and leaves legacy devices alone',async()=>{
 const readToken='notifications-'.padEnd(64,'n'),requests=[],store=memory();await pollBinanceNotifications({devices:[device()],store,readToken,now,fetcher:async(url,opts)=>{requests.push({url,opts});return {ok:true,json:async()=>({live:[fill]})};},send:async()=>{},remove:async()=>{}});assert.equal(requests.length,1);assert.equal(requests[0].opts.method,'GET');assert.match(requests[0].url,/api\/binance-action-log$/);assert.equal(requests[0].opts.headers.Authorization,'Bearer '+readToken);assert.equal(requests[0].opts.redirect,'error');assert.equal(store.data.get('status').data.accepted,1);assert(!JSON.stringify([...store.data]).includes(readToken));
 await pollBinanceNotifications({devices:[{subscription}],store,now,fetcher:async()=>{throw Error('must not fetch');}});assert.equal(store.data.get('status').data.devices,0);
});
test('missing notification credential fails before fetching or sending and stores only a generic failure',async()=>{
 for(const readToken of [undefined,'short','x'.repeat(40)+'\n']){
  const store=memory();await assert.rejects(pollBinanceNotifications({devices:[device()],store,readToken,now,fetcher:async()=>assert.fail('must not fetch'),send:async()=>assert.fail('must not send')}),/BINANCE_PUSH_READ_TOKEN_REQUIRED/);
  assert.equal(store.data.get('status').data.error,'BINANCE_READ_OR_PUSH_UNAVAILABLE');
 }
});
test('both signal and trade feeds carry the dedicated credential and rejected authentication sends nothing',async()=>{
 const readToken='notifications-'.padEnd(64,'n'),requests=[],store=memory(),d={...device(),topics:['binance-trades','binance-signals']};
 await assert.rejects(pollBinanceNotifications({devices:[d],store,readToken,now,fetcher:async(url,options)=>{requests.push({url,options});return {ok:false,status:401};},send:async()=>assert.fail('must not send')}),/BINANCE_READ_UNAVAILABLE/);
 assert.equal(requests.length,2);for(const r of requests){assert.equal(r.options.headers.Authorization,'Bearer '+readToken);assert.equal(r.options.method,'GET');assert.equal(new URL(r.url).origin,'https://levi-binance.2-29-48-20.sslip.io');}
 assert.equal(store.data.get('status').data.error,'BINANCE_READ_OR_PUSH_UNAVAILABLE');
});
test('notification clicks route trades into Binance and reject external navigation',async()=>{
 const handlers={},opened=[],shown=[];const ctx=vm.createContext({URL,self:{addEventListener:(name,fn)=>handlers[name]=fn,registration:{showNotification:async(...args)=>shown.push(args)}},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}});vm.runInContext(fs.readFileSync(new URL('../push-sw.js',import.meta.url),'utf8'),ctx);let pending;const waitUntil=p=>{pending=p;};handlers.push({data:{json:()=>({title:'BUY',url:'/binance-agent.html'})},waitUntil});await pending;assert.equal(shown[0][1].data.url,'/binance-agent.html');handlers.notificationclick({notification:{data:{url:'https://evil.example'},close(){}},waitUntil});await pending;assert.deepEqual(opened,['/push.html']);
});
