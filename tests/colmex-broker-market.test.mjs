import test from 'node:test';import assert from 'node:assert/strict';
import {BrokerMarketReader,brokerChart,brokerQuote,brokerMarketError} from '../lib/colmex-broker-market.mjs';
import {makeBrokerMarketHandler} from '../lib/colmex-market-endpoints.mjs';
import {validStockSnapshot} from '../lib/colmex-market-cache.mjs';
const start=Date.parse('2026-10-21T13:30:00Z'),now=start+90*60000;
const history={barDetails:Array.from({length:18},(_,i)=>({t:start+(i+1)*300000,o:100+i,h:102+i,l:99+i,c:101+i,v:10}))};
const env={COLMEX_API_LOGIN:'test',COLMEX_API_PASSWORD:'test-only',COLMEX_AUTO_ACCOUNT_ID:'123'};
function client(catalog=[{name:'AMD',type:'EQUITY',tradableInstrumentId:45}]){const calls=[];return {calls,getAccounts:async()=>[{id:'123',currency:'USD'}],get:async path=>{calls.push(path);if(path.includes('/instruments?'))return {instruments:catalog};if(path.startsWith('/instruments/'))return {quotingCurrency:'USD'};if(path.startsWith('/history?'))return history;if(path.startsWith('/quotes?'))return {bp:117,ap:117.02};throw Error('Unexpected GET');}};}
test('broker right-edge candle timestamps become open timestamps exactly once, exclude partial bars and retain source',()=>{
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
 const at=Date.parse('2026-10-21T19:30:00Z'),bars={barDetails:Array.from({length:6},(_,i)=>({t:at+(i+1)*300000,o:100,h:102,l:99,c:101,v:1}))};
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
 assert.equal(c.calls.length,0);const response=await chart({httpMethod:'GET',queryStringParameters:{symbol:'AMD',interval:'5min'}});assert.equal(response.statusCode,200);assert.equal(JSON.parse(response.body).source,'Colmex Pro');assert.match(cache[0],/^colmex-broker-market-v1:chart:123:AMD:5min$/);
 const quote=makeBrokerMarketHandler('quote',{env:()=>env,readerFactory:()=>reader,cacheRead:async o=>o.fetchData()});assert.equal(JSON.parse((await quote({httpMethod:'GET',queryStringParameters:{symbol:'AMD'}})).body).priceKind,'BROKER_BID');
});
test('read failures stay explicit and never claim zero positions or reveal provider errors',async()=>{
 const chart=makeBrokerMarketHandler('chart',{env:()=>env,readerFactory:()=>({account:async()=>{throw Error('private-details');}})});
 const response=await chart({httpMethod:'GET',queryStringParameters:{symbol:'AMD'}}),data=JSON.parse(response.body);assert.equal(response.statusCode,503);assert.equal(data.code,'BROKER_DATA_UNAVAILABLE');assert.ok(!response.body.includes('private-details'));
 assert.match(brokerMarketError({code:'ACCESS_DENIED'}).error,/הרשאת/);
});
