import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
test('disabled cost guard does not request depth or reject execution',async()=>{const start=source.indexOf('async function checkEntryCost('),end=source.indexOf('const entryTrackingState=',start);let requests=0;const context={fetch:()=>{requests++;throw Error('No depth');}};vm.createContext(context);vm.runInContext(source.slice(start,end),context);const result=await context.checkEntryCost('BTCUSDT',28.73);assert.equal(result.ok,true);assert.equal(result.enabled,false);assert.equal(requests,0);});
test('entry eligibility is independent of exit sizing and preserves stablecoin exclusion',async()=>{
 const start=source.indexOf('    if(!p){\n      ev.entryFilters='),end=source.indexOf('    ev.demoTradable=',start);
 for(const ok of [true,false]){
  const ev={analysisSignal:true,entryConfirmed:true,entryEligible:true,buyQualified:true,rawDecision:'BUY',wyckoffTrade:{patternId:'fresh'},strategy:{buyConfirmed:true}};
  const context={p:null,ev,s:'BTCUSDT',entryBars:[],ENTRY_POLICY_VERSION:'test',assessQualityEntry:()=>({ok,code:ok?'HOURLY_TREND_DISABLED':'WAIT_STABLECOIN',enabled:!ok})};
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);assert.equal(ev.entryConfirmed,ok);assert.equal(ev.analysisSignal,true);assert.equal(ev.entryFilters.enabled,!ok);
  if(ok){assert.equal(ev.wyckoffTrade.atrStopPct,undefined);assert.equal(ev.wyckoffTrade.hourlyTrend.ok,true);}else{assert.equal(ev.wyckoffTrade,null);assert.equal(ev.rawDecision,'HOLD');assert.equal(ev.buyReason,'WAIT_STABLECOIN');}
 }
});
test('LIVE still enforces five slots, real funds and fresh prices; quality checks are absent from order loop',()=>{assert.match(source,/const LIVE_MAX_POSITIONS=5/);assert.match(source,/if\(held>=LIVE_MAX_POSITIONS\)\{recordEntryBlocker\([^\n]+break;\}/);assert.match(source,/if\(activeBalances.length>=LIVE_MAX_POSITIONS\)throw/);assert.match(source,/funding.usdtFree\|\|0\)<quoteUsdt\*1.002/);assert.match(source,/requireLivePrice\(streams\[s\]\)/);const cycle=source.slice(source.indexOf('async function executeLiveCycle('),source.indexOf('async function getLiveAccountSnapshot('));assert.doesNotMatch(cycle,/assessQualityEntry|checkEntryCost/);assert.match(cycle,/liveNextBuyAllocation\(account/);assert.match(source,/entryCostFilter:\{enabled:false/);assert.match(source,/entryFiltersEnabled:true/);});
