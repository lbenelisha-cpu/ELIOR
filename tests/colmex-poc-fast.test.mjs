import test from 'node:test';import assert from 'node:assert/strict';
import {pocFixture} from './helpers/poc-channel-fixture.mjs';
import {PocFastWatch} from '../lib/poc-fast-watch.mjs';
import {initialState,runCycle} from '../lib/colmex-auto-runner.mjs';
import {runColmexFastPoll,colmexFastCandidates,runColmexFastWorker} from '../lib/colmex-poc-fast.mjs';
import {channelEntryConfig} from '../lib/channel-primary-entry.mjs';
import {colmexChannelSignal} from '../lib/colmex-channel-entry.mjs';
import {AUTO_POLICY,LIVE_ACK} from '../lib/colmex-auto-policy.mjs';
import {dispatchColmexFast,claimColmexFastTicket} from '../lib/colmex-fast-dispatch.mjs';
const D=300000,end=Date.parse('2026-11-06T20:00Z');
const env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123',COLMEX_CHANNEL_PRIMARY_ENABLED:'true',COLMEX_CHANNEL_PRIMARY_AFTER:new Date(end-D).toISOString()};
function fixture(side='LONG'){
 let at=end+1000;const i=pocFixture({platform:'COLMEX',side,end,entryPrice:side==='LONG'?106:104});i.symbol='AAPL';i.ask=i.price+.01;
 const state=initialState(end-D);state.cursor=AUTO_POLICY.symbols.indexOf('AAPL');
 const snapshot=()=>({account:{tradingRules:{supportSelfTrading:true,supportBrackets:true}},state:{availableCash:2000},positions:[],orders:[],history:[],historyAvailable:true});
 let quoteReads=0,historyReads=0;const broker={writes:[],snapshot:async()=>snapshot(),instruments:async()=>[{name:'AAPL',type:'EQUITY',tradableInstrumentId:1}],details:async()=>({quotingCurrency:'USD',symbolStatus:'FULLY_OPEN',tickSize:[{leftRangeLimit:0,tickSize:.01}],lotStep:1,lotSize:1,minLot:1,maxLot:1000}),
 quote:async()=>{quoteReads++;return {bp:i.price,ap:i.ask};},history:async()=>{historyReads++;return {barDetails:[...(i.trendBars||i.bars),i.liveBar].map(b=>({t:b.openTime,o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}))};},write:async(a,intent)=>{broker.writes.push(structuredClone(intent));return {orderId:'offline'};}};
 const args={state,broker,env:{...env},now:()=>at,deadline:at+27000,save:async()=>{}};
 const seed=()=>{const w=new PocFastWatch({},()=>at);w.observe('AAPL',colmexChannelSignal({...i,priceAsOf:at,now:at},channelEntryConfig(env,'COLMEX')));state.pocFastWatch=w.state;state.lastCycleAt=at;};
 return {i,state,broker,args,snapshot,seed,setTime:v=>at=v,reads:()=>({quoteReads,historyReads})};
}
for(const side of ['LONG','SHORT'])test('Colmex '+side+' scans normally, then acts on a POC return between scheduled scans with one durable protected intent',async()=>{
 const f=fixture(side),price=f.i.price,ask=f.i.ask;f.i.price+=side==='LONG'?-.3:.3;f.i.ask=f.i.price+.01;
 f.i.liveBar.close=f.i.price;if(side==='LONG')f.i.liveBar.low=f.i.price;else f.i.liveBar.high=f.i.ask;
 await runCycle(f.args);assert.equal(f.broker.writes.length,0);assert.equal(colmexFastCandidates(f.state,env,f.args.now()).length,1);
 const cursor=f.state.cursor;f.setTime(end+3000);f.i.price=price;f.i.ask=ask;f.i.liveBar.close=price;if(side==='LONG')f.i.liveBar.low=price;else f.i.liveBar.high=ask;
 await runColmexFastPoll(f.args);assert.equal(f.broker.writes.length,1,JSON.stringify(f.state.checks));assert.equal(f.broker.writes[0].order.side,side==='LONG'?'buy':'sell');assert.equal(f.broker.writes[0].order.stopLossType,'offset%');assert.equal(f.state.cursor,cursor,'fast polling does not move the discovery cursor');
 f.setTime(end+5000);await runColmexFastPoll(f.args);assert.equal(f.broker.writes.length,1,'pending receipt prevents replay');
});
test('a cached candidate cannot bypass changed evidence, broker permissions, funds or final prices',async()=>{
 for(const kind of ['consolidation','cash','permission','price','expired-bar','halt','disabled','closed']){
  const f=fixture();f.seed();let count=0;const history=f.broker.history,quote=f.broker.quote;
  if(kind==='consolidation')f.broker.history=async()=>{const h=await history();for(let k=24;k<30;k++)h.barDetails[h.barDetails.length-53+k].h+=4;return h;};
  if(kind==='cash')f.broker.snapshot=async()=>({...f.snapshot(),state:{availableCash:1}});
  if(kind==='permission')f.broker.snapshot=async()=>({...f.snapshot(),account:{tradingRules:{}}});
  if(kind==='price')f.broker.quote=async()=>++count>=3?{bp:105,ap:105.01}:quote();
  if(kind==='expired-bar')f.setTime(end+D);
  if(kind==='halt')f.state.halt='UNRESOLVED';
  if(kind==='disabled')f.args.env.COLMEX_AUTO_LIVE_ENABLED='false';
  if(kind==='closed')f.setTime(Date.parse('2026-11-07T20:00Z'));
  await runColmexFastPoll(f.args);assert.equal(f.broker.writes.length,0,kind);
 }
});
test('background polling respects the shared lease, releases before waiting and backs off on read failures',async()=>{
 const f=fixture();f.seed();let acquired=0,releases=0,errors=0,sleeps=0;
 f.broker.history=async()=>{throw Error('RATE_LIMIT');};
 const r=await runColmexFastWorker({env,until:f.args.now()+75000,now:f.args.now,acquire:async()=>{acquired++;return acquired===1?null:{state:f.state,save:f.args.save,release:async()=>releases++};},brokerFactory:()=>f.broker,sleep:async ms=>{assert.equal(releases,0);sleeps++;f.setTime(f.args.now()+ms);},onError:()=>errors++});
 assert.equal(acquired,2);assert.equal(releases,1);assert.equal(sleeps,1);assert.equal(errors,1);assert.equal(r.polls,0);assert.equal(f.broker.writes.length,0);
});
test('background worker exits without market calls when no candidate is armed',async()=>{
 const f=fixture();let release=0;
 const r=await runColmexFastWorker({env,until:f.args.now()+75000,now:f.args.now,acquire:async()=>({state:f.state,save:f.args.save,release:async()=>release++}),brokerFactory:()=>{throw Error('Unexpected API call');},sleep:async()=>{throw Error('Unexpected wait');}});
 assert.equal(r.polls,0);assert.equal(release,1);
});
function memoryStore(){const rows=new Map();let revision=0;return {rows,async get(k){return rows.get(k)?.data;},async getWithMetadata(k){return structuredClone(rows.get(k)||null);},async setJSON(k,data,options){const prev=rows.get(k);if(options.onlyIfNew&&prev||options.onlyIfMatch!==undefined&&prev?.etag!==options.onlyIfMatch)return {modified:false};const etag=String(++revision);rows.set(k,{data:structuredClone(data),etag});return {modified:true,etag};},async delete(k){rows.delete(k);}};}
test('background work requires a production account-bound single-use ticket; replays and invalid requests cannot start it',async()=>{
 const f=fixture();f.seed();const store=memoryStore();let token;
 const send=async()=>dispatchColmexFast({store,env,state:f.state,now:f.args.now,fetchImpl:async(url,o)=>{assert.match(url,/^https:\/\/levi-emptying-tracker\.netlify\.app\//);assert.equal(o.redirect,'error');token=JSON.parse(o.body).ticket;return {status:202};}});
 assert.equal(await send(),true);
 for(const bad of [{token:'bogus',env},{token,env:{...env,CONTEXT:'deploy-preview'}},{token,env:{...env,COLMEX_AUTO_ACCOUNT_ID:'999'}}])assert.equal(await claimColmexFastTicket({...bad,store,now:f.args.now}),null);
 const results=await Promise.all([claimColmexFastTicket({token,env,store,now:f.args.now}),claimColmexFastTicket({token,env,store,now:f.args.now})]);assert.equal(results.filter(Boolean).length,1);
 assert.equal(await claimColmexFastTicket({token,env,store,now:f.args.now}),null);
 await send();f.setTime(f.args.now()+16000);assert.equal(await claimColmexFastTicket({token,env,store,now:f.args.now}),null);
});
test('failed background dispatch cleans its ticket and never contacts a broker',async()=>{
 const f=fixture();f.seed();const store=memoryStore();
 assert.equal(await dispatchColmexFast({store,env,state:f.state,now:f.args.now,fetchImpl:async()=>{throw Error('NETWORK');}}),false);assert.equal(store.rows.size,0);assert.equal(f.broker.writes.length,0);
});
test('worker cannot starve a due broad scan, and records execution decisions in the existing audit',async()=>{
 const f=fixture();f.seed();f.state.lastCycleAt=f.args.now()-56000;let releases=0;
 const r=await runColmexFastWorker({env,until:f.args.now()+75000,now:f.args.now,acquire:async()=>({state:f.state,save:f.args.save,release:async()=>releases++}),brokerFactory:()=>f.broker,sleep:async ms=>f.setTime(f.args.now()+ms)});
 assert.equal(f.broker.writes.length,1);assert.ok(f.state.lastCompletedAt);assert.ok(f.state.maAudit.rows.some(r=>r.action==='ENTER'),JSON.stringify(f.state.maAudit));assert.equal(r.polls,1);assert.equal(releases,2);
});
test('the fast worker releases its lease after a durable-save failure and cannot send an entry',async()=>{
 const f=fixture();f.seed();let releases=0;
 await assert.rejects(runColmexFastWorker({env,until:f.args.now()+75000,now:f.args.now,acquire:async()=>({state:f.state,save:async()=>{throw Object.assign(Error('STATE_SAVE_FAILED'),{statePersistenceFailure:true});},release:async()=>releases++}),brokerFactory:()=>f.broker}),/STATE_SAVE_FAILED/);
 assert.equal(releases,1);assert.equal(f.broker.writes.length,0);
});
