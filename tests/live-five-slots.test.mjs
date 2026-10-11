import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
function allocation(saved=null){
  const files=new Map(saved?[['allocation',JSON.stringify(saved)]]:[]);
  const context=vm.createContext({LIVE_MAX_POSITIONS:5,LIVE_ALLOCATION_FILE:'allocation',ensureStateDir(){},fs:{
    existsSync:p=>files.has(p),readFileSync:p=>files.get(p),
    writeFileSync:(p,v)=>files.set(p,v),renameSync:(a,b)=>{files.set(b,files.get(a));files.delete(a);}
  }});
  const start=source.indexOf('function fixedLiveAllocation(');
  const end=source.indexOf('\n\nfunction saveLiveActionLog',start);
  vm.runInContext('let liveAllocation=null;'+source.slice(start,end),context);
  return {run:n=>vm.runInContext(`fixedLiveAllocation(${n})`,context),files};
}
test('LIVE freezes one fifth of initial capital and keeps profits in cash',()=>{
  const a=allocation();assert.equal(a.run(150).positionUsdt,30);
  assert.equal(a.run(200).positionUsdt,30);
  assert.equal(JSON.parse(a.files.get('allocation')).maxPositions,5);
});
test('existing ten-percent allocation migrates without resetting the baseline',()=>{
  const a=allocation({baseUsdt:143.627715,positionUsdt:14.3627715,at:'original'});
  const r=a.run(90);assert.equal(r.baseUsdt,143.627715);
  assert.equal(r.positionUsdt,143.627715/5);assert.equal(r.at,'original');
});
test('LIVE permits fifth position and rejects sixth while DEMO remains ten',async()=>{
  const start=source.indexOf('async function executeLiveCycle(');
  const end=source.indexOf('\nasync function getLiveAccountSnapshot',start);
  for(const held of [4,5]){
    const buys=[];let count=held;
    const context=vm.createContext({mode:'live',LIVE:true,AUTO_EXECUTION:true,LIVE_MAX_POSITIONS:5,LIVE_MAX_USDT:100,
      liveTradingGate:()=>({ready:true,withdrawalsEnabled:false}),getApiRestrictions:async()=>({}),
      liveOrders:{recover:async()=>{}},signedBinanceGet(){},recordLiveFill(){},liveActionLog:[],tradeControl:{paused:false},
      getLiveAccountSnapshot:async()=>({balances:Array.from({length:count},(_,i)=>({asset:'HELD'+i,qty:1,valueUsdt:30})),fixedPositionUsdt:30,usdtFree:90}),
      placeLiveMarketBuy:async s=>{buys.push(s);count++;}
    });
    vm.runInContext(source.slice(start,end),context);
    context.evals=[{ok:true,entryConfirmed:true,symbol:'NEWUSDT',wyckoffTrade:{patternId:'new'}}];
    await vm.runInContext('executeLiveCycle(evals)',context);
    assert.equal(buys.length,held===4?1:0);
  }
  assert.match(source,/const MAX=10;/);
  assert.match(source,/new DemoTrader\(\{\s*maxPositions:MAX/);
});
