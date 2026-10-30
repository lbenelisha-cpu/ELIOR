import test from 'node:test';
import assert from 'node:assert/strict';
import {NEWS_SOURCES,NEWS_VERSION,newsConfig,newsAsset,identifyNews,parseNewsFeed,assessNewsEntry,createNewsCollector} from '../lib/market-news.mjs';
const now=Date.parse('2026-10-30T12:00:00Z');
const sources=NEWS_SOURCES.slice(0,2),config=newsConfig({MARKET_NEWS_ENTRY_OVERLAY:'true',MARKET_NEWS_ENTRY_AFTER:new Date(now-600000).toISOString()});
const xml=(title='Strategy buys 1,000 bitcoin for its treasury',source=sources[0],at=now-60000,extra='')=>`<rss><channel><item><title><![CDATA[${title}]]></title><link>https://${source.host}/news/story</link><pubDate>${new Date(at).toUTCString()}</pubDate>${extra}</item></channel></rss>`;
const row=(title,source=sources[0])=>({...parseNewsFeed(xml(title,source),source,now).rows[0],firstSeenAt:now-1000});
const snapshot=(items=[row('Strategy buys 1,000 bitcoin for its treasury'),row('Strategy purchases 1000 BTC in latest acquisition',sources[1])])=>({version:NEWS_VERSION,baselineAt:now-600000,collectedAt:now,items,sources:sources.map(s=>({id:s.id,status:'OK',lastSuccessAt:now}))});

test('explicit names and catalogued stock tokens avoid ambiguous symbol inference',()=>{
 assert.equal(newsAsset('NVDABUSDT'),'stock:NVDA');assert.equal(newsAsset('BNBUSDT'),'crypto:BNB');assert.equal(newsAsset('FOOBUSDT'),null);
 assert.deepEqual(identifyNews('Near gains as the link gains momentum').assets,[]);
 assert.deepEqual(identifyNews('Bitcoin Cash adoption grows').assets.map(a=>a.id),['crypto:BCH']);
 const x=identifyNews('Nvidia invests in a blockchain startup');assert.equal(x.kind,'investment');assert.deepEqual(x.assets.map(a=>a.id),['stock:NVDA']);assert.equal(x.event,null);
 assert.equal(identifyNews('BlackRock buys 1000 bitcoin for its treasury').event.asset,'crypto:BTC');
});
test('only narrow completed purchases/outages qualify; rumors, negation, future plans and resolved incidents do not',()=>{
 for(const title of ['Strategy plans to buy 1000 bitcoin','Strategy buys 1000 bitcoin last week','BlackRock buys 1000 bitcoin ETF shares','Strategy buys 1000 bitcoin futures','Tesla buys 1000 Ethereum Classic','Strategy buys 1000 Bitcoin Cash','Strategy buys 1000 BTC: hoax debunked','Strategy buys 1000 bitcoin?','Strategy buys 1000 bitcoin, reportedly','Strategy buys 1000 bitcoin: fake report','Strategy buys 1000 bitcoin and Ethereum','Strategy buys 1000 bitcoin last year','Nvidia invests $1 billion in AI','Ethereum network suffers an outage after upgrade; service restored','Ethereum token suffers an outage','Solana testnet suffers outage'])assert.equal(identifyNews(title).event,null,title);
 assert.equal(identifyNews('Ethereum network suffers an outage').event.direction,'negative');
 assert.equal(identifyNews('Strategy purchases 1,234.5 BTC').event.quantity,1234.5);
});
test('RSS rejects entities, HTML responses, unsafe links, future/undated reports and strips markup',()=>{
 for(const bad of ['<html>error</html>','<!DOCTYPE rss><rss></rss>','<rss><!ENTITY x "evil"></rss>','<rss>'])assert.throws(()=>parseNewsFeed(bad,sources[0],now),/INVALID_FEED/);
 const valid=xml('<img src=x onerror=alert(1)>Bitcoin &amp; Ethereum');assert.equal(parseNewsFeed(valid,sources[0],now).rows[0].title,'Bitcoin & Ethereum');
 for(const changed of [xml().replace('https://www.coindesk.com','javascript://www.coindesk.com'),xml().replace('www.coindesk.com','evil.example'),xml().replace('https://','https://user@'),xml(undefined,sources[0],now+1e5),xml(undefined,sources[0],now-8*86400000),xml().replace(/<pubDate>.*?<\/pubDate>/,'')])assert.equal(parseNewsFeed(changed,sources[0],now).rows.length,0);
 const wire=parseNewsFeed(xml(undefined,sources[0],now-60000,'<dc:creator>PR Newswire</dc:creator>'),sources[0],now).rows[0];assert.equal(wire.editorial,false);
});
test('entry overlay is opt in, after activation and baseline; it never authorizes a technical entry',()=>{
 assert.equal(newsConfig({}).enabled,false);assert.equal(newsConfig({MARKET_NEWS_ENTRY_OVERLAY:'true'}).enabled,false);
 assert.equal(assessNewsEntry(snapshot(),'BTCUSDT',{},now).action,'NONE');
 const x=assessNewsEntry(snapshot(),'BTCUSDT',config,now);assert.equal(x.action,'PRIORITIZE');assert.equal(x.priority,1);assert.equal(x.evidence.length,2);assert.equal(x.buy,undefined);
 for(const boundary of [now-60000,now+1000])assert.equal(assessNewsEntry(snapshot(),'BTCUSDT',{...config,enabledAfter:boundary},now).action,'NONE');
 assert.equal(assessNewsEntry({...snapshot(),baselineAt:now},'BTCUSDT',config,now).action,'NONE');
 assert.equal(assessNewsEntry(snapshot(),'MSTRBUSDT',config,now).reason,'ASSET_OBSERVATION_ONLY');
});
test('distinct publishers must agree on asset, actor, amount and timing; copies, edits and stale records cannot count',()=>{
 const pair=snapshot().items;
 for(const change of [r=>r.group=pair[0].group,r=>r.title=pair[0].title,r=>r.editorial=false,r=>r.uncertain=true,r=>r.revised=true,r=>r.publishedAt=now+1,r=>r.firstSeenAt=now+1,r=>r.firstSeenAt=r.publishedAt+1800001,r=>r.publishedAt=now-3600001,r=>r.event.key+='0']){
  const items=structuredClone(pair);change(items[1]);assert.equal(assessNewsEntry(snapshot(items),'BTCUSDT',config,now).action,'NONE');
 }
 const old={...pair[0],id:'old-purchase',publishedAt:now-7200000,firstSeenAt:now-7100000};assert.equal(assessNewsEntry(snapshot([...pair,old]),'BTCUSDT',config,now).action,'NONE');
 const outage=[row('Ethereum network suffers an outage'),row('Ethereum experiences an outage in latest disruption',sources[1])];assert.equal(assessNewsEntry(snapshot(outage),'ETHUSDT',config,now).action,'BLOCK');
 for(const extra of [{collectedAt:now-900001},{collectedAt:now+1},{storageError:'ERROR'},{sources:snapshot().sources.map(x=>({...x,status:'UNAVAILABLE'}))}])assert.equal(assessNewsEntry({...snapshot(),...extra},'BTCUSDT',config,now).action,'NONE');
});
test('collector deduplicates concurrent calls, persists first seen across restart, records revisions and bounds polling',async()=>{
 let clock=now,calls=0,saved,title='Strategy buys 1000 bitcoin';
 const fetchImpl=async url=>{calls++;return new Response(xml(title,sources.find(s=>s.url===url),clock-60000));};
 const options={sources,fetchImpl,now:()=>clock,save:x=>saved=structuredClone(x)};
 const c=createNewsCollector(options);await Promise.all([c.poll(),c.poll(),c.poll()]);assert.equal(calls,2);assert.equal(c.snapshot().items.length,2);const first=c.snapshot().items[0].firstSeenAt;
 await c.poll();assert.equal(calls,2);clock+=300000;
 const restored=createNewsCollector({...options,load:()=>saved});title='Strategy buys 1000 bitcoin for treasury';await restored.poll();assert.equal(calls,4);assert.equal(restored.snapshot().items[0].firstSeenAt,first);assert.equal(restored.snapshot().items[0].revised,true);
 const corrupt=createNewsCollector({...options,load:()=>{throw Error();}});assert.ok(corrupt.snapshot().storageError);await corrupt.poll();assert.equal(corrupt.snapshot().baselineAt,clock);assert.equal(corrupt.snapshot().storageError,null);
});
test('source failure/backoff and storage failure remain explicit and cannot produce positive readiness',async()=>{
 let calls=0,clock=now;
 const c=createNewsCollector({sources,now:()=>clock,fetchImpl:async()=>{calls++;return new Response('',{status:429});},save:()=>{throw Error();}});
 await c.poll();assert.equal(calls,2);assert.equal(c.snapshot().sources[0].error,'RATE_LIMITED');assert.equal(c.snapshot().storageError,'NEWS_STORE_UNAVAILABLE');
 clock+=300000;await c.poll();assert.equal(calls,4);clock+=300000;await c.poll();assert.equal(calls,4);
});
test('collector limits bytes including streamed bodies and refuses redirects at fetch boundary',async()=>{
 let options;
 const c=createNewsCollector({sources:[sources[0]],now:()=>now,fetchImpl:async(url,o)=>{assert.equal(url,sources[0].url);options=o;return new Response('x'.repeat(2000001));}});
 await c.poll();assert.equal(options.redirect,'error');assert.equal(c.snapshot().sources[0].error,'FEED_TOO_LARGE');assert.equal(c.snapshot().items.length,0);
});
