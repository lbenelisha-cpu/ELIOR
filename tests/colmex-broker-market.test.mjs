import test from 'node:test';import assert from 'node:assert/strict';
import {BrokerMarketReader,brokerChart,brokerQuote,brokerMarketError,brokerQuantityRules} from '../lib/colmex-broker-market.mjs';
import {makeBrokerMarketHandler,makeBrokerMarketService} from '../lib/colmex-market-endpoints.mjs';
import {validStockSnapshot} from '../lib/colmex-market-cache.mjs';
const start=Date.parse('2026-10-21T13:30:00Z'),now=start+90*60000;
const history={barDetails:Array.from({length:18},(_,i)=>({t:start+i*300000,o:100+i,h:102+i,l:99+i,c:101+i,v:10}))};
const env={COLMEX_API_LOGIN:'test',COLMEX_API_PASSWORD:'test-only',COLMEX_AUTO_ACCOUNT_ID:'123'};
function client(catalog=[{name:'AMD',type:'EQUITY',tradableInstrumentId:45}]){const calls=[];return {calls,getAccounts:async()=>[{id:'123',currency:'USD'}],get:async path=>{calls.push(path);if(path.includes('/instruments?'))return {instruments:catalog};if(path.startsWith('/instruments/'))return {quotingCurrency:'USD'};if(path.startsWith('/history?'))return history;if(path.startsWith('/quotes?'))return {bp:117,ap:117.02};throw Error('Unexpected GET');}};}
test('broker opening timestamps remain unchanged, exclude partial bars and retain source',()=>{
 const data=brokerChart({barDetails:[...history.barDetails,{...history.barDetails[0],t:now+10000}]},'AMD','5min',now);
 assert.equal(data.bars.length,18);assert.equal(data.bars[0].date,new Date(start).toISOString());assert.equal(data.priceAt,new Date(now).toISOString());assert.equal(data.source,'Colmex Pro');assert.equal(data.priceKind,'LAST_BAR_CLOSE');
 assert.equal(validStockSnapshot(data,'AMD','5min','Colmex Pro'),true);assert.equal(validStockSnapshot(data,'AMD','5min'),false);
 assert.throws(()=>brokerChart({barDetails:[]},'AMD','5min',now));assert.throws(()=>brokerChart({barDetails:[{...history.barDetails[0],l:999}]},'AMD','5min',now));
});
test('all chart intervals keep original 5-minute analysis and aggregate hour/day OHLC',()=>{
 for(const interval of ['5min','10min','15min','1h','1day']){const data=brokerChart(history,'AMD',interval,now);assert.equal(data.analysisBars.length,18);assert.ok(data.bars.length);assert.equal(data.interval,interval);}
 const hour=brokerChart(history,'AMD','1h',now);assert.equal(hour.bars[0].open,100);assert.equal(hour.bars[0].close,112);assert.equal(hour.bars[0].high,113);
 const day=brokerChart(history,'AMD','1day',now);assert.equal(day.bars[0].date,'2026-10-21');assert.equal(day.bars[0].close,118);
});
test('final half-hour of a US session is a valid closed hour bucket, gaps are not invented',()=>{
 const at=Date.parse('2026-10-21T19:30:00Z'),bars={barDetails:Array.from({length:6},(_,i)=>({t:at+i*300000,o:100,h:102,l:99,c:101,v:1}))};
 const data=brokerChart(bars,'AMD','1h',at+1800000);assert.equal(data.bars.length,1);assert.equal(data.bars[0].closed,true);
 assert.throws(()=>brokerChart({barDetails:bars.barDetails.slice(1)},'AMD','1h',at+1800000));
});
test('bid quotes preserve bid/ask and never invent an upstream timestamp',()=>{
 const data=brokerQuote({bp:'100',ap:'100.1'},'AMD',now);assert.equal(data.price,100);assert.equal(data.ask,100.1);assert.equal(data.priceAt,null);assert.equal(data.observedAt,new Date(now).toISOString());
 for(const quote of [{bp:100,ap:99},{bp:0,ap:1},{bp:null,ap:1},{bp:1,ap:Infinity}])assert.throws(()=>brokerQuote(quote,'AMD',now));
});
test('reader uses GET market operations, validates catalog and currency, reuses metadata',async()=>{
 const c=client(),reader=new BrokerMarketReader({env,client:c,now:()=>now});
 assert.equal((await reader.chart('AMD','5min')).bars.length,18);assert.equal((await reader.quote('AMD')).price,117);
 assert.equal(c.calls.filter(p=>p.includes('/instruments?')).length,1);assert.equal(c.calls.filter(p=>p.startsWith('/instruments/')).length,1);
 assert.ok(c.calls.some(p=>p.startsWith('/history?')&&p.includes('resolution=5m')));assert.ok(c.calls.every(p=>!p.includes('/orders')&&!p.includes('/positions')));
 await assert.rejects(()=>reader.chart('UNKNOWN','5min'),/UNAVAILABLE/);
 for(const catalog of [[{name:'AMD',type:'CFD',tradableInstrumentId:45}],[{name:'AMD',type:'EQUITY',tradableInstrumentId:'45/bad'}],[...c.calls.slice(0,0),{name:'AMD',type:'EQUITY',tradableInstrumentId:45},{name:'AMD',type:'ETF',tradableInstrumentId:46}]])await assert.rejects(()=>new BrokerMarketReader({env,client:client(catalog),now:()=>now}).chart('AMD','5min'));
 const wrong=client();wrong.getAccounts=async()=>[{id:'999',currency:'USD'}];await assert.rejects(()=>new BrokerMarketReader({env,client:wrong}).chart('AMD','5min'),/ACCOUNT_UNAVAILABLE/);
});
test('endpoint is read-only, rejects caller-controlled accounts/URLs and does not use Twelve Data',async()=>{
 const c=client(),reader=new BrokerMarketReader({env,client:c,now:()=>now}),cache=[];
 const chart=makeBrokerMarketHandler('chart',{env:()=>env,readerFactory:()=>reader,cacheRead:async options=>{cache.push(options.key);const data=await options.fetchData();assert.ok(options.validate(data));return data;}});
 assert.equal((await chart({httpMethod:'POST'})).statusCode,405);
 for(const q of [{symbol:'AMD',accountId:'999'},{symbol:'https://bad'},{symbol:'AMD',interval:'1s'}])assert.equal((await chart({httpMethod:'GET',queryStringParameters:q})).statusCode,400);
 assert.equal(c.calls.length,0);const response=await chart({httpMethod:'GET',queryStringParameters:{symbol:'AMD',interval:'5min'}});assert.equal(response.statusCode,200);assert.equal(JSON.parse(response.body).source,'Colmex Pro');assert.match(cache[0],/^colmex-broker-market-v2:chart:123:AMD:5min$/);
 const quote=makeBrokerMarketHandler('quote',{env:()=>env,readerFactory:()=>reader,cacheRead:async o=>o.fetchData()});assert.equal(JSON.parse((await quote({httpMethod:'GET',queryStringParameters:{symbol:'AMD'}})).body).priceKind,'BROKER_BID');
});
test('read failures stay explicit and never claim zero positions or reveal provider errors',async()=>{
 const chart=makeBrokerMarketHandler('chart',{env:()=>env,readerFactory:()=>({account:async()=>{throw Error('private-details');}})});
 const response=await chart({httpMethod:'GET',queryStringParameters:{symbol:'AMD'}}),data=JSON.parse(response.body);assert.equal(response.statusCode,503);assert.equal(data.code,'BROKER_DATA_UNAVAILABLE');assert.ok(!response.body.includes('private-details'));
 assert.match(brokerMarketError({code:'ACCESS_DENIED'}).error,/הרשאת/);
});

test('chart and quote routes reuse one authenticated reader and reject unknown views',async()=>{
 let created=0;const c=client();const service=makeBrokerMarketService({env:()=>env,readerFactory:options=>{created++;return new BrokerMarketReader({...options,client:c,now:()=>now});},cacheRead:async options=>options.fetchData()});
 const event={httpMethod:'GET',queryStringParameters:{symbol:'AMD',interval:'5min'}};assert.equal((await service(event)).statusCode,200);
 const quote=await service({httpMethod:'GET',queryStringParameters:{symbol:'AMD',view:'quote'}});assert.equal(quote.statusCode,200);assert.equal(JSON.parse(quote.body).priceKind,'BROKER_BID');assert.equal(created,1);assert.equal(c.calls.filter(p=>p.includes('/instruments?')).length,1);
 assert.equal((await service({httpMethod:'GET',queryStringParameters:{symbol:'AMD',view:'orders'}})).statusCode,400);
});

test('validated cached market data remains available when broker authentication is temporarily unavailable',async()=>{
 let providerCalls=0;const data=brokerChart(history,'AMD','5min',now);
 const endpoint=makeBrokerMarketHandler('chart',{env:()=>env,readerFactory:()=>({account:async()=>{throw Error('AUTH_DENIED');},chart:async()=>{providerCalls++;throw Error('AUTH_DENIED');}}),cacheRead:async options=>{assert.match(options.key,/:123:AMD:5min$/);assert.ok(options.validate(data));return {...data,cacheState:'PROVIDER_UNAVAILABLE_CACHE'};}});
 const result=await endpoint({httpMethod:'GET',queryStringParameters:{symbol:'AMD',interval:'5min'}});assert.equal(result.statusCode,200);assert.equal(JSON.parse(result.body).priceAt,data.priceAt);assert.equal(providerCalls,0);
});

test('documented open times preserve complete 78-bar sessions and do not reset a normal overnight continuation',async()=>{
 const {contiguousHistory,brokerBars}=await import('../lib/colmex-auto-policy.mjs');
 const previous=Date.parse('2026-10-20T13:30:00Z'),current=Date.parse('2026-10-21T13:30:00Z');
 const bar=t=>({t,o:100,h:102,l:99,c:101,v:1});const raw={barDetails:[...Array.from({length:78},(_,i)=>bar(previous+i*300000)),...Array.from({length:3},(_,i)=>bar(current+i*300000)),bar(current+900000)]};
 const rows=brokerBars(raw,current+900000);assert.equal(rows.length,81);assert.equal(rows[0].openTime,previous);assert.equal(rows[77].closeTime,previous+390*60000);assert.equal(contiguousHistory(rows).discarded,0);
});
test('quantity diagnostics expose only normalized share limits and leave unknown fields unknown',()=>{
 assert.deepEqual(brokerQuantityRules({lotSize:1,minLot:1,lotStep:1,maxLot:1000}),{minQty:1,qtyStep:1,maxQty:1000});
 assert.equal(brokerQuantityRules({lotSize:1,minLot:.001,lotStep:.001,maxLot:1000}).minQty,.001);
 assert.deepEqual(brokerQuantityRules({lotSize:null,minLot:1}),{minQty:null,qtyStep:null,maxQty:null});
});
