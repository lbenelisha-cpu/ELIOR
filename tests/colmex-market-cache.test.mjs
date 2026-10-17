import test from 'node:test';import assert from 'node:assert/strict';
import {cachedStockRead,validStockSnapshot} from '../lib/colmex-market-cache.mjs';
const data={symbol:'TSLA',currency:'USD',source:'Twelve Data',price:354.72,priceAt:'2026-10-16T19:59:00Z',interval:'5min',bars:[{date:'2026-10-16T19:55:00Z',open:354,high:355,low:353,close:354.72}]};
const now=Date.parse('2026-10-17T06:00:00Z'),validate=d=>validStockSnapshot(d,'TSLA','5min');
test('closed-market snapshots avoid repeat provider requests and preserve original prices/times',async()=>{
 let calls=0;const store={read:async()=>({data,savedAt:new Date(now-60000).toISOString()}),write:async()=>{throw Error('unexpected write');}};const result=await cachedStockRead({key:'test',store,now,validate,fetchData:async()=>{calls++;throw Error();}});assert.equal(calls,0);assert.equal(result.priceAt,data.priceAt);assert.equal(result.cacheState,'MARKET_CLOSED_CACHE');assert.equal(result.price,354.72);
});
test('provider failure during market hours serves a labeled validated snapshot; wrong stock/interval or old cache cannot substitute',async()=>{
 const open=Date.parse('2026-10-16T19:30:00Z'),savedAt=new Date(open-120000).toISOString(),fetchData=async()=>{throw Error('provider limit');};
 const result=await cachedStockRead({key:'test',store:{read:async()=>({data,savedAt})},now:open,validate,fetchData});assert.equal(result.cacheState,'PROVIDER_UNAVAILABLE_CACHE');assert.match(result.notice,/הספק אינו זמין/);
 for(const snapshot of [{data:{...data,symbol:'AAPL'},savedAt},{data:{...data,interval:'1day'},savedAt},{data,savedAt:new Date(open-8*86400000).toISOString()}])await assert.rejects(()=>cachedStockRead({key:'test',store:{read:async()=>snapshot},now:open,validate,fetchData}));
});
test('first load seeds durable history; storage failure never hides a valid provider response',async()=>{
 let saved;const result=await cachedStockRead({key:'test',now,validate,store:{read:async()=>null,write:async(k,p)=>{saved=p;}},fetchData:async()=>data});assert.deepEqual(saved.data,data);assert.equal(result.cacheState,'PROVIDER');
 assert.equal((await cachedStockRead({key:'test',now,validate,store:{read:async()=>{throw Error();},write:async()=>{throw Error();}},fetchData:async()=>data})).price,354.72);
});
