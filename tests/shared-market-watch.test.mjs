import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedWatchRows,SharedMarketWatch,SHARED_WATCH_POLICY} from '../lib/shared-market-watch.mjs';
import {shortConfig} from '../lib/futures-short-policy.mjs';
import {attentionSnapshot} from '../lib/market-attention.mjs';
const D=300000,end=Date.parse('2026-11-06T10:00Z'),now=end+1000;
const contract=base=>({symbol:base+'USDT',baseAsset:base,status:'TRADING',contractType:'PERPETUAL',marginAsset:'USDT',quoteAsset:'USDT'});
function bars(){
 const data=Array.from({length:205},(_,i)=>{const p=210-(100+i*.02+Math.cos(i*Math.PI/5));return [end-(205-i)*D,p,p+.1,p-.1,p,1000,end-(204-i)*D-1];});
 for(let j=0;j<3;j++){const p=105.95+(j===1?.01:0);data[202+j].splice(1,4,p,p+.1,p-.1,p);}
 data.push([end,105,105.1,103.9,104,2000,end+D-1]);return data;
}
function harness(){
 const h={clock:now,source:['GOOGLBUSDT','BTCUSDT','NVDABUSDT'],catalog:[contract('GOOGL'),contract('BTC')],calls:[],blocker:'FUTURES_TWO_SLOTS_FULL',failure:null};
 h.watch=new SharedMarketWatch({now:()=>h.clock,symbols:()=>h.source,config:()=>shortConfig({}),entryBlocker:()=>h.blocker,read:async(route,params)=>{
  h.calls.push({route,params});if(h.failure?.(route,params))throw Error('offline');
  if(route==='/fapi/v1/exchangeInfo')return {symbols:h.catalog};
  if(route==='/fapi/v1/klines')return bars();
  if(route==='/fapi/v1/ticker/bookTicker')return {symbol:params.symbol,bidPrice:'104',askPrice:'104.01',time:h.clock};
  throw Error('Non-public read attempted: '+route);
 }});return h;
}
test('shared mapping verifies GOOGL stock-token identity and exact Futures units without suffix guessing or volume cutoffs',()=>{
 const names=['GOOGLBUSDT','BNBUSDT','FOOBUSDT','SHIBUSDT','NVDABUSDT','GOOGLBUSDT','<bad>'];
 const rows=sharedWatchRows(names,[contract('GOOGL'),contract('BNB'),contract('FOO'),contract('1000SHIB'),{...contract('NVDA'),status:'SETTLING'}]);
 assert.equal(rows.length,5);assert.equal(rows[0].futuresSymbol,'GOOGLUSDT');assert.equal(rows[0].asset,'stock:GOOGL');
 assert.equal(rows[1].futuresSymbol,'BNBUSDT');assert.equal(rows[2].futuresSymbol,null);assert.equal(rows[3].futuresSymbol,null);assert.equal(rows[4].futuresSymbol,null);
 for(const patch of [{baseAsset:'OTHER'},{marginAsset:'USDC'},{quoteAsset:'USDC'},{contractType:'CURRENT_QUARTER'}])assert.equal(sharedWatchRows(['GOOGLBUSDT'],[{...contract('GOOGL'),...patch}])[0].available,false);
 assert.equal(sharedWatchRows(['GOOGLBUSDT'],[contract('GOOGL'),contract('GOOGL')])[0].available,false);
 assert.equal(sharedWatchRows(['GOOGLBUSDT'])[0].mappingReason,'FUTURES_MARKETS_UNVERIFIED');
});
test('disabled entries, no funds, full slots and durable halts never stop public observation or authorize execution',async()=>{
 for(const blocker of ['FUTURES_SHORT_DISABLED','FUTURES_ENTRIES_PAUSED','FUTURES_NEED_35_USDT_FREE_PER_SLOT','FUTURES_TWO_SLOTS_FULL','PROTECTION_FAILURE','FUTURES_JOURNAL_UNREADABLE']){
  const h=harness();h.blocker=blocker;await h.watch.tick();const s=h.watch.snapshot(),row=s.rows[0];
  assert.equal(row.futuresSymbol,'GOOGLUSDT');assert.equal(row.reason,'SHORT_CHANNEL_READY');assert.equal(row.ready,true);assert.equal(row.observationOnly,true);assert.equal(row.entryBlocker,blocker);
  assert.deepEqual(h.calls.map(x=>x.route),['/fapi/v1/exchangeInfo','/fapi/v1/klines','/fapi/v1/ticker/bookTicker']);
  assert.equal(s.rows[2].mappingReason,'FUTURES_SYMBOL_UNAVAILABLE');assert.equal(s.rows[2].at,null);
 }
});
test('round-robin scans survive one-symbol failure, prevent concurrent duplicate reads and remove obsolete members',async()=>{
 const h=harness();h.failure=(route,p)=>route.includes('klines')&&p.symbol==='GOOGLUSDT';
 await Promise.all([h.watch.tick(),h.watch.tick()]);assert.equal(h.calls.filter(x=>x.route.includes('exchangeInfo')).length,1);assert.equal(h.watch.snapshot().rows[0].reason,'FUTURES_OBSERVATION_UNAVAILABLE');
 h.clock+=2001;await h.watch.tick();assert.equal(h.watch.snapshot().rows[1].reason,'SHORT_CHANNEL_READY');
 h.source=['BTCUSDT'];h.clock+=2001;await h.watch.tick();assert.equal(h.watch.snapshot().rows.length,1);assert.deepEqual(Object.keys(h.watch.checks),['BTCUSDT']);
});
test('stale observations, expired bars and unavailable contract metadata cannot remain ready',async()=>{
 const h=harness();await h.watch.tick();h.clock+=180001;assert.equal(h.watch.snapshot().rows[0].ready,false);assert.equal(h.watch.snapshot().rows[0].reason,'STALE_SHORT_OBSERVATION');
 h.clock=now+300001;h.failure=route=>route.includes('exchangeInfo');await h.watch.tick();assert.equal(h.watch.snapshot().rows[0].mappingReason,'FUTURES_MARKETS_UNVERIFIED');assert.equal(h.watch.snapshot().rows[0].ready,false);
 const count=h.calls.length;h.clock+=2001;await h.watch.tick();assert.equal(h.calls.length,count);
 h.failure=null;h.clock+=30001;await h.watch.tick();assert.equal(h.watch.snapshot().rows[0].available,true);
});
test('observer validates Futures quote identity and cannot substitute Spot prices',async()=>{
 const h=harness(),read=h.watch.read;h.watch.read=(route,p)=>route.includes('bookTicker')?Promise.resolve({symbol:'GOOGLBUSDT',bidPrice:104,askPrice:105,time:h.clock}):read(route,p);
 await h.watch.tick();assert.equal(h.watch.snapshot().rows[0].reason,'WAIT_FRESH_FUTURES_PRICE');assert.equal(h.watch.snapshot().rows[0].ready,false);
});
test('attention board joins stock-token and Futures checks only through verified mapping',async()=>{
 const h=harness();await h.watch.tick();const watch=h.watch.snapshot();
 const snapshot=attentionSnapshot({state:{},news:{},symbols:h.source,now:h.clock,sharedWatch:watch,longEntryBlocker:'NO_FREE_SLOT',shortChecks:{GOOGLUSDT:{at:h.clock,reason:'SHORT_VOLUME_LOW'}}});
 const row=snapshot.rows.find(r=>r.symbol==='GOOGLBUSDT');assert.equal(row.shortDecision.reason,'SHORT_VOLUME_LOW');assert.equal(row.shortObservation.futuresSymbol,'GOOGLUSDT');assert.equal(row.entryBlockers.long,'NO_FREE_SLOT');assert.equal(row.entryBlockers.short,'FUTURES_TWO_SLOTS_FULL');assert.equal(snapshot.sharedWatchPolicy.version,SHARED_WATCH_POLICY.version);
 const unmapped=snapshot.rows.find(r=>r.symbol==='NVDABUSDT');assert.equal(unmapped.shortObservation.available,false);assert.equal(unmapped.shortDecision,null);
});

test('parallel reports survive the public SHORT snapshot and expire with their original scan',async()=>{
 const h=harness();await h.watch.tick();const row=h.watch.snapshot().rows[0];
 assert.equal(row.conditions.version,'CHANNEL_CONDITIONS_PARALLEL_V1');assert.equal(row.conditions.side,'SHORT');assert.equal(row.conditions.rows.filter(r=>r.state==='passed').length,10);
 const board=attentionSnapshot({state:{},news:{},symbols:h.source,now:h.clock,sharedWatch:h.watch.snapshot()});
 assert.deepEqual(board.rows.find(r=>r.symbol===row.spotSymbol).shortObservation.conditions,row.conditions);
 h.clock=end+D;assert.equal(h.watch.snapshot().rows[0].conditions,null);
});
