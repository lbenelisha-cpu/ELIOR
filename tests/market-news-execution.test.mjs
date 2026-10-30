import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {withLiveSafety} from './helpers/live-safety.mjs';
const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const buy=source.slice(source.indexOf('async function placeLiveMarketBuy('),source.indexOf('async function placeLiveMarketSell('));
function executor({manual=false,blocked=false,late=false}={}){
 const writes=[],checks=[];let veto=blocked;
 const context=withLiveSafety({Date,newsEntryAssessment:()=>{checks.push('NEWS');return {action:veto?'BLOCK':'PRIORITIZE',priority:1,reason:'NEWS_NETWORK_OUTAGE',evidence:[{id:'news-proof'}]};},
  nativeProtection:{rows:{},uncertain:()=>false,sync:async()=>{}},getApiRestrictions:async()=>({}),liveTradingGate:()=>({ready:true}),liveManagedPositions:()=>({}),
  symbolExchangeInfo:async()=>({status:'TRADING',quoteAsset:'USDT',ocoAllowed:true,orderTypes:['TAKE_PROFIT','STOP_LOSS'],filters:[]}),
  getLiveAccountSnapshot:async()=>({balances:[],usdtFree:100}),liveNextBuyAllocation:()=>({ok:true,amountUsdt:20}),LIVE_MAX_POSITIONS:5,LIVE_MAX_USDT:400,
  candles:async()=>{if(late)veto=true;return [];},assessQualityEntry:()=>({ok:true}),ENTRY_POLICY_VERSION:'TEST',requireLivePrice:()=>100,streams:{BTCUSDT:{}},
  manualBuyAmount:q=>q,manualPosition:()=>({entryMode:'manual'}),recordLiveFill(){},
  liveOrders:{submit:async(params,meta)=>{writes.push({params,meta});return {};}}
 });
 vm.createContext(context);vm.runInContext(buy,context);
 return {writes,checks,run:()=>context.placeLiveMarketBuy('BTCUSDT',20,manual?'MANUAL_BUY':'READY',{wyckoffTrade:{entryMode:'test'}})};
}
test('final automatic BUY rechecks news after history reads and records evidence without changing order sizing',async()=>{
 const good=executor();await good.run();assert.equal(good.writes.length,1);assert.equal(Number(good.writes[0].params.quoteOrderQty),20);assert.equal(good.writes[0].meta.meta.newsDecision.evidence[0].id,'news-proof');
 for(const opt of [{blocked:true},{late:true}]){const x=executor(opt);await assert.rejects(x.run,/NEWS_NETWORK_OUTAGE/);assert.equal(x.writes.length,0);}
 const manual=executor({manual:true,blocked:true});await manual.run();assert.equal(manual.writes.length,1);assert.equal(manual.checks.length,0);
});
test('priority only sorts technical candidates; veto removes entries, neither news state nor outage affects sell function',()=>{
 const start=source.indexOf('function newsEntryCandidates('),end=source.indexOf('\nfunction newsChannelSnapshot',start);
 const context=vm.createContext({newsEntryAssessment:s=>({action:s==='VETO'?'BLOCK':s==='GOOD'?'PRIORITIZE':'NONE',priority:s==='GOOD'?1:0})});vm.runInContext(source.slice(start,end),context);
 const candidate=s=>({symbol:s,ok:true,entryConfirmed:true,wyckoffTrade:{}});
 assert.deepEqual(Array.from(context.newsEntryCandidates([candidate('NORMAL'),candidate('GOOD'),candidate('VETO'),{...candidate('NO_TECHNICAL'),entryConfirmed:false}]),x=>x.symbol),['GOOD','NORMAL']);
 const sell=source.slice(source.indexOf('async function placeLiveMarketSell('),source.indexOf('async function executeLiveCycle('));assert.doesNotMatch(sell,/newsEntryAssessment|marketNews/);
});
