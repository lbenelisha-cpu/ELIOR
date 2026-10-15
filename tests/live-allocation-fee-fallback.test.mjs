import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
function harness(saved){
 const files=new Map(saved?[['allocation',JSON.stringify(saved)]]:[]);
 const actions=[{type:'SELL',symbol:'BTCUSDT',orderId:2,qty:1,amountUsdt:110,commissions:[],quoteFeeUsdt:0},
  {type:'BUY',symbol:'BTCUSDT',orderId:1,qty:1,amountUsdt:100,commissions:[{asset:'BNB',amount:.001}],quoteFeeUsdt:0}];
 const ctx=vm.createContext({LIVE_MAX_POSITIONS:5,LIVE_ALLOCATION_FILE:'allocation',liveActionLog:actions,ensureStateDir(){},fs:{existsSync:p=>files.has(p),readFileSync:p=>files.get(p),writeFileSync:(p,v)=>files.set(p,v),renameSync:(a,b)=>{files.set(b,files.get(a));files.delete(a);}}});
 const text=source.slice(source.indexOf('function liveRealizedPnl('),source.indexOf('\n\nfunction saveLiveActionLog'));
 vm.runInContext('let liveAllocation=null;'+text,ctx);return {ctx,files,run:n=>vm.runInContext(`fixedLiveAllocation(${n})`,ctx)};
}
test('third-asset fees preserve prior allocation instead of failing the account or inventing profit',()=>{
 const h=harness({baseUsdt:150,positionUsdt:30,initialBaseUsdt:140,realizedBaselineUsdt:0,reinvestedProfitUsdt:10,maxPositions:5});
 assert.throws(()=>vm.runInContext('liveRealizedPnl(liveActionLog)',h.ctx),/LIVE_REALIZED_FEE_VALUATION_REQUIRED/);
 const r=h.run(200);assert.equal(r.baseUsdt,150);assert.equal(r.positionUsdt,30);assert.equal(r.profitReinvestmentPaused,true);assert.equal(r.realizedPnlComplete,false);assert.equal(r.reinvestedProfitUsdt,10);
 assert.equal(h.run(90).positionUsdt,30);
});
test('first account read with unknown fees persists a stable base without an invented realized baseline',()=>{
 const h=harness();assert.equal(h.run(100).positionUsdt,20);const saved=JSON.parse(h.files.get('allocation'));
 assert.equal(saved.baseUsdt,100);assert.equal(saved.realizedBaselineUsdt,undefined);assert.equal(h.run(200).positionUsdt,20);
});
test('complete fee data resumes the existing reinvestment calculation',()=>{
 const h=harness({baseUsdt:100,positionUsdt:20,initialBaseUsdt:100,realizedBaselineUsdt:0,maxPositions:5});h.run(110);
 h.ctx.liveActionLog[1].commissions=[];const r=h.run(110);assert.equal(r.baseUsdt,110);assert.equal(r.positionUsdt,22);assert.notEqual(r.profitReinvestmentPaused,true);
});
