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
test('news never changes final automatic or manual submission, sizing or protection',async()=>{
 for(const opt of [{},{blocked:true},{late:true},{manual:true,blocked:true}]){
  const x=executor(opt);await x.run();assert.equal(x.writes.length,1);assert.equal(Number(x.writes[0].params.quoteOrderQty),20);assert.equal(x.checks.length,0);
 }
});
test('news cannot filter, reorder or create technical candidates and does not enter exits',()=>{
 const start=source.indexOf('function newsEntryCandidates('),end=source.indexOf('\nfunction newsChannelSnapshot',start);
 const context=vm.createContext({newsEntryAssessment:()=>{throw Error('news must not affect candidates');}});vm.runInContext(source.slice(start,end),context);
 const candidate=s=>({symbol:s,ok:true,entryConfirmed:true,wyckoffTrade:{}});
 assert.deepEqual(Array.from(context.newsEntryCandidates([candidate('NORMAL'),candidate('GOOD'),candidate('VETO'),{...candidate('NO_TECHNICAL'),entryConfirmed:false}]),x=>x.symbol),['NORMAL','GOOD','VETO']);
 const sell=source.slice(source.indexOf('async function placeLiveMarketSell('),source.indexOf('async function executeLiveCycle('));assert.doesNotMatch(sell,/newsEntryAssessment|marketNews/);
 assert.match(source,/const marketNewsConfig=\{\.\.\.newsConfig\(process.env\),enabled:false/);
 const evaluate=source.slice(source.indexOf('async function evaluateSymbol('),source.indexOf('function setAgentFromEval('));assert.doesNotMatch(evaluate,/newsDecision.action/);
});
