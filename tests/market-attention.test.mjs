import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {NEWS_SOURCES,parseNewsFeed} from '../lib/market-news.mjs';
import {newsAttention,technicalObservation,recordAttention,prioritizeObservationSymbols,attentionSnapshot} from '../lib/market-attention.mjs';
import {channelEntry,channelEntryConfig} from '../lib/channel-primary-entry.mjs';
import {patchAttention} from '../scripts/patch-market-attention.mjs';
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
 const config=channelEntryConfig({BINANCE_CHANNEL_PRIMARY_ENABLED:'true',BINANCE_CHANNEL_PRIMARY_AFTER:new Date(end-STEP).toISOString()});
 const entry=channelEntry({bars:b,price:106,priceAsOf:now,now,liveBar:{openTime:end,closeTime:end+STEP,open:105,high:106.1,low:104.9,close:106,volume:2000,closed:false,receivedAt:now}},config);assert.equal(entry.ready,true,entry.reason);
 const o=technicalObservation({symbol:'ETHUSDT',bars:b,at:now});assert.equal(o.period,50);assert.equal(o.dataAt,end);assert.equal(o.channel.upper,entry.setup.level);assert.equal(o.channel.lowTouches,entry.setup.lowTouches);assert.equal(o.channel.highTouches,entry.setup.highTouches);assert.equal(o.volume.ratio,2);assert.equal(o.volume.basis,'LAST_CLOSED_BAR');assert.equal(o.regression.slope,entry.setup.regressionSlope);
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
test('installer is atomic and idempotent while preserving unrelated production edits',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'attention-patch-'));
 try{
  const patches=JSON.parse(fs.readFileSync(new URL('../scripts/market-attention-patches.json',import.meta.url)));
  for(const file of ['server.mjs','binance-agent.html']){
   let s=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
   // Reconstruct the original installer's source context before the later shared-watch integration.
   const later=JSON.parse(fs.readFileSync(new URL('../scripts/shared-market-watch-patches.json',import.meta.url),'utf8'));
   for(const p of later.filter(p=>p.file===file).reverse())s=s.replace(p.after,p.before);
   for(const p of patches.filter(p=>p.file===file).reverse())s=s.replace(p.after,p.before);
   fs.writeFileSync(path.join(root,file),s+'\n// unrelated production edit\n');
  }
  patchAttention(root,patches);const first=fs.readFileSync(path.join(root,'server.mjs'),'utf8');patchAttention(root,patches);assert.equal(fs.readFileSync(path.join(root,'server.mjs'),'utf8'),first);assert.match(first,/unrelated production edit/);
  assert.throws(()=>patchAttention(root,[{file:'server.mjs',before:'// unrelated production edit',after:'// changed'},{file:'binance-agent.html',before:'nonexistent',after:'nonexistent replacement sentinel'}]),/no files changed/);assert.equal(fs.readFileSync(path.join(root,'server.mjs'),'utf8'),first);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
