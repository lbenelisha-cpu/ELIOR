import test from 'node:test';
import assert from 'node:assert/strict';
import {NEWS_SOURCES,parseNewsFeed} from '../lib/market-news.mjs';
import {newsAttention,technicalObservation,recordAttention,prioritizeObservationSymbols,attentionSnapshot} from '../lib/market-attention.mjs';
import {channelEntry,channelEntryConfig} from '../lib/channel-primary-entry.mjs';
const STEP=300000,end=Date.parse('2026-11-03T12:00:00Z'),now=end+1000;
function bars(){return Array.from({length:205},(_,i)=>{const p=100+i*.02+Math.cos(i*Math.PI/5);return {openTime:end-(205-i)*STEP,closeTime:end-(204-i)*STEP,open:p,close:p,high:p+.1,low:p-.1,volume:1000,closed:true};});}
const row=(title='Ethereum network suffers an outage',source=NEWS_SOURCES[0],at=now-60000)=>({...parseNewsFeed(`<rss><channel><item><title>${title}</title><link>https://${source.host}/news/test</link><pubDate>${new Date(at).toUTCString()}</pubDate></item></channel></rss>`,source,now).rows[0],firstSeenAt:now-1000});
const news=(items=[row()])=>({collectedAt:now,baselineAt:now-600000,items,sources:NEWS_SOURCES.map(s=>({...s,status:'OK',lastSuccessAt:now}))});
test('news raises attention for explicit mapped assets without an entry action; uncertainty and failed sources stay explicit',()=>{
 const n=newsAttention(news(),'ETHUSDT',now);assert.equal(n.active,true);assert.equal(n.action,undefined);assert.equal(n.evidence[0].verification,'SINGLE_REPORT');
 assert.equal(newsAttention(news([row('Nvidia invests in a new facility')]),'NVDABUSDT',now).active,true);
 assert.equal(newsAttention(news(),'FOOBUSDT',now).covered,false);
 const uncertain=newsAttention(news([row('Ethereum may experience an outage?')]),'ETHUSDT',now);assert.equal(uncertain.evidence[0].verification,'UNCERTAIN');assert.equal(uncertain.matchingReports.length,0);
 for(const change of [n=>n.storageError='FAIL',n=>n.collectedAt=now+1,n=>n.collectedAt=now-900000,n=>n.sources.forEach(s=>s.status='UNAVAILABLE'),n=>n.items[0].publishedAt=now-21600001,n=>n.items[0].publishedAt=now+1,n=>n.items[0].firstSeenAt=now+1,n=>n.items[0].url='https://evil.example/story']){const x=news();change(x);assert.equal(newsAttention(x,'ETHUSDT',now).active,false);}
});
test('corroboration describes narrow matching reports, never converts an outage into an order veto; copies and revisions do not count',()=>{
 const pair=[row(),row('Ethereum experiences an outage in latest disruption',NEWS_SOURCES[1])];
 const result=newsAttention(news(pair),'ETHUSDT',now);assert.equal(result.matchingReports.length,2);assert.equal(result.action,undefined);
 for(const mutate of [r=>r.revised=true,r=>r.title=pair[0].title,r=>r.group=pair[0].group,r=>r.editorial=false]){const items=structuredClone(pair);mutate(items[1]);assert.equal(newsAttention(news(items),'ETHUSDT',now).matchingReports.length,0);}
 const duplicate=newsAttention(news([pair[0],{...pair[0],id:'copy'}]),'ETHUSDT',now);assert.equal(duplicate.evidence.length,1);
});
test('observers use the entry window and confirmed geometry, exclude open candles and expose volume and missing data',()=>{
 const b=bars();Object.assign(b.at(-1),{volume:2000});
 // A neutral pre-entry range lets the entry and observer geometry be compared.
 for(const [i,bar] of b.slice(-3).entries()){const p=104.05+(i===1?.01:0);Object.assign(bar,{open:p,close:p,high:p+.1,low:p-.1});}
 // The observer is a current-window measurement, not the frozen POC entry model.
 const o=technicalObservation({symbol:'ETHUSDT',bars:b,at:now});assert.equal(o.period,50);assert.equal(o.dataAt,end);assert.ok(o.channel.upper>0);assert.ok(o.channel.lowTouches>=2);assert.ok(o.channel.highTouches>=2);assert.equal(o.volume.ratio,2);assert.equal(o.volume.basis,'LAST_CLOSED_BAR');assert.ok(Number.isFinite(o.regression.slope));
 const live={...b.at(-1),openTime:end,closeTime:end+STEP,closed:false,close:9999,high:10000};assert.deepEqual(technicalObservation({symbol:'ETHUSDT',bars:[...b,live],at:now}),o);
 const missing=structuredClone(b);delete missing.at(-1).volume;const m=technicalObservation({symbol:'ETHUSDT',bars:missing,at:now});assert.equal(m.volume.ratio,null);assert.ok(m.missing.includes('VOLUME_DATA'));
 for(const mutate of [x=>x.splice(-4,1),x=>x.at(-1).high=1,x=>x.push(x.at(-1)),x=>x.splice(0,160)]){const x=structuredClone(b);mutate(x);assert.equal(technicalObservation({symbol:'ETHUSDT',bars:x,at:now}).ready,false);}
 assert.equal(technicalObservation({symbol:'ETHUSDT',bars:b,at:end+STEP}).reason,'STALE_HISTORY');
});
test('read-only priority keeps the same universe and stable order; observations are bounded and invalidate promptly',()=>{
 assert.deepEqual(prioritizeObservationSymbols(['BTCUSDT','ETHUSDT','BTCUSDT','SOLUSDT'],news(),now),['ETHUSDT','BTCUSDT','SOLUSDT']);
 const state={executionJournal:{untouched:true}};const input={symbol:'ETHUSDT',bars:bars(),at:now};recordAttention(state,input);recordAttention(state,{...input,at:now+1});assert.equal(state.marketAttention.events.length,1);assert.deepEqual(state.executionJournal,{untouched:true});
 const args={state,news:news(),symbols:['ETHUSDT'],now:now+1,diagnostics:{ETHUSDT:{at:now,reason:'WAIT_CHANNEL_BREAKOUT'}}};
 let snap=attentionSnapshot(args);assert.equal(snap.rows[0].technical.ready,true);assert.equal(snap.rows[0].news.active,true);
 snap=attentionSnapshot({...args,now:now+180001});assert.equal(snap.rows[0].technical.ready,false);assert.equal(snap.rows[0].longDecision,null);
 assert.equal(attentionSnapshot({...args,mode:'demo'}).rows[0].technical.ready,false);
 assert.equal(attentionSnapshot({...args,storageError:'FAIL'}).rows[0].technical.ready,false);
 recordAttention(state,{symbol:'ETHUSDT',at:now+2,error:'HISTORY_UNAVAILABLE'});assert.equal(attentionSnapshot({...args,now:now+2}).rows[0].technical.ready,false);
 for(let i=0;i<400;i++)recordAttention(state,{symbol:'ASSET'+i,at:now+3+i,error:'HISTORY_UNAVAILABLE'});assert.equal(Object.keys(state.marketAttention.observations).length,150);assert.equal(state.marketAttention.events.length,300);
 const restored=JSON.parse(JSON.stringify(state));assert.deepEqual(attentionSnapshot({...args,state:restored}),attentionSnapshot(args));
});
