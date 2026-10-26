import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeMarket,readHandler as handler,fetchChartSnapshot,marketFailure} from '../netlify/functions/colmex-stocks-market.mjs';
const series={meta:{symbol:'AAPL',currency:'USD',type:'Common Stock',exchange:'NASDAQ'},values:[{datetime:'2026-10-14 14:35:00',open:'100',high:'107',low:'99',close:'105'},{datetime:'2026-10-14 14:30:00',open:'99',high:'103',low:'98',close:'100'}],cached_at:'2026-10-14T14:36:00Z'};
test('external bars are chronological UTC and unavailable quotes use an explicitly labelled bar close',()=>{const d=normalizeMarket(series,null,'AAPL','5min');assert.equal(d.bars[0].date,'2026-10-14T14:30:00Z');assert.equal(d.price,105);assert.equal(d.priceKind,'LAST_BAR_CLOSE');assert.equal(d.isMarketOpen,null);assert.match(d.notice,/עיכוב/);});
test('quote timestamps remain provider timestamps, separate from fetch times',()=>{const d=normalizeMarket(series,{symbol:'AAPL',currency:'USD',close:'106',last_quote_at:1791988800,cached_at:'2026-10-15T10:00:00Z',is_market_open:false},'AAPL','5min');assert.equal(d.price,106);assert.equal(d.priceKind,'PROVIDER_QUOTE');assert.equal(d.priceAt,new Date(1791988800000).toISOString());assert.equal(d.isMarketOpen,false);assert.equal(d.quoteFetchedAt,'2026-10-15T10:00:00Z');});
test('wrong instrument, currency, malformed candles and duplicate bars are rejected',()=>{for(const meta of [{...series.meta,symbol:'MSFT'},{...series.meta,currency:'EUR'},{...series.meta,type:'Forex'}])assert.throws(()=>normalizeMarket({...series,meta},null,'AAPL','5min'));assert.throws(()=>normalizeMarket({...series,values:[{...series.values[0],high:50}]},null,'AAPL','5min'));assert.throws(()=>normalizeMarket({...series,values:[series.values[0],series.values[0]]},null,'AAPL','5min'));});
test('a quote for another instrument cannot override the requested series',()=>{assert.equal(normalizeMarket(series,{symbol:'MSFT',currency:'USD',close:999},'AAPL','5min').price,105);});
test('bad requests and writes never contact the external provider',async()=>{assert.equal((await handler({httpMethod:'POST'})).statusCode,405);assert.equal((await handler({httpMethod:'GET',queryStringParameters:{symbol:'https://invalid',interval:'1day'}})).statusCode,400);assert.equal((await handler({httpMethod:'GET',queryStringParameters:{symbol:'AAPL',interval:'1s'}})).statusCode,400);});
test('weekly and monthly candles retain exchange calendar dates instead of adding intraday UTC suffixes',()=>{const daily={...series,values:[{datetime:'2026-10-01',open:100,high:110,low:95,close:105}]};for(const interval of ['1week','1month']){const d=normalizeMarket(daily,null,'AAPL',interval);assert.equal(d.bars[0].date,'2026-10-01');assert.equal(d.interval,interval);}});

test('loading a chart spends one series request and does not spend a quote credit',async()=>{
 const calls=[];const result=await fetchChartSnapshot(async(...args)=>{calls.push(args);return series;},'AAPL','5min');
 assert.equal(calls.length,1);assert.equal(calls[0][0],'time_series');assert.equal(calls[0][1].prepost,false);assert.equal(calls[0][1].outputsize,1000);assert.equal(calls[0][2],60);
 assert.equal(result.priceKind,'LAST_BAR_CLOSE');assert.equal(result.price,105);assert.equal(result.priceAt,'2026-10-14T14:35:00.000Z'.replace('.000',''));
});

test('quota diagnostics distinguish daily exhaustion from a temporary rate limit without exposing provider messages',()=>{
 assert.equal(marketFailure(Error('You have run out of API credits for the day. 800 credits were used today')).code,'DAILY_PROVIDER_LIMIT');
 assert.equal(marketFailure(Error('ממתין למכסת נתונים — ניסיון נוסף')).code,'PROVIDER_LIMIT');
 assert.equal(marketFailure(Error('API limit per minute')).code,'PROVIDER_LIMIT');
 const result=marketFailure(Error('failure secret-private-value'));assert.equal(result.code,'PROVIDER_UNAVAILABLE');assert.ok(!result.error.includes('secret-private-value'));
});
