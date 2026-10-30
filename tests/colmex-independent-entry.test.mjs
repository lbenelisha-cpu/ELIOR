import test from 'node:test';
import assert from 'node:assert/strict';
import {colmexBreakoutConfig,colmexBreakoutEntry} from '../lib/colmex-independent-entry.mjs';
import {regularSession} from '../lib/colmex-market-hours.mjs';
import {initialState,runCycle} from '../lib/colmex-auto-runner.mjs';
import {AUTO_POLICY,LIVE_ACK} from '../lib/colmex-auto-policy.mjs';
const step=300000,end=Date.parse('2026-10-30T15:00:00Z'),now=end+1000;
const env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123',COLMEX_INDEPENDENT_BREAKOUT_ENABLED:'true',COLMEX_INDEPENDENT_BREAKOUT_AFTER:new Date(end-step).toISOString()};
const config=colmexBreakoutConfig(env);
function bars(){const b=[];for(let t=end-5*86400000;t<end;t+=step)if(regularSession(t))b.push({openTime:t,closeTime:t+step,open:100.5,high:100.6,low:100.4,close:100.5,volume:1000,closed:true});const out=b.slice(-205);Object.assign(out.at(-1),{open:100.6,high:101.3,low:100.55,close:101.2,volume:2000});return out;}
const input=()=>({bars:bars(),price:101.2,priceAsOf:now,now,entryAfter:end-step,used:[],liveBar:{openTime:end,low:101.1,high:101.3}});
function fixture(){
 const state=initialState(end-step);state.cursor=AUTO_POLICY.symbols.indexOf('AAPL');
 const snapshot=()=>({account:{tradingRules:{supportSelfTrading:true,supportBrackets:true}},state:{availableCash:2000},positions:[],orders:[],history:[],historyAvailable:true});
 const history=()=>({barDetails:[...bars().map(b=>({t:b.openTime,o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume})),{t:end,o:101.2,h:101.3,l:101.1,c:101.2,v:10}]});
 const b={writes:[],reads:0,snapshot:async()=>snapshot(),instruments:async()=>[{name:'AAPL',type:'EQUITY',tradableInstrumentId:1}],details:async()=>({quotingCurrency:'USD',symbolStatus:'FULLY_OPEN',tickSize:[{leftRangeLimit:0,tickSize:.01}],lotStep:1,lotSize:1,minLot:1,maxLot:1000}),quote:async()=>({bp:101.2,ap:101.21}),history:async()=>{b.reads++;return history();},write:async(a,i)=>{b.writes.push(structuredClone(i));return {orderId:'offline'};}};
 return {state,b,snapshot,history,args:{state,broker:b,env,now:()=>now,deadline:now+27000,save:async()=>{}}};
}
test('Colmex resistance breakout is disabled by default, requires a new signal and retains volume, trend and price checks',()=>{
 assert.equal(colmexBreakoutConfig({}).enabled,false);assert.equal(colmexBreakoutConfig({COLMEX_INDEPENDENT_BREAKOUT_ENABLED:'true'}).enabled,false);
 assert.equal(colmexBreakoutEntry(input(),{}).ready,false);const good=colmexBreakoutEntry(input(),config);assert.equal(good.ready,true);assert.equal(good.setup.entryMode,'independent_breakout');assert.equal(good.setup.secondRallyHigh,undefined);
 for(const change of [x=>x.bars.at(-1).volume=1000,x=>x.bars.at(-1).closed=false,x=>x.priceAsOf-=11000,x=>x.liveBar.low=100,x=>x.entryAfter=end,x=>x.used=[good.setup.patternId],x=>x.bars.splice(50,1)]){const x=input();change(x);assert.equal(colmexBreakoutEntry(x,config).ready,false);}
});
test('a qualifying breakout independently submits one protected intent without Spring and cannot repeat it',async()=>{
 const f=fixture();await runCycle(f.args);assert.equal(f.b.writes.length,1);assert.equal(f.b.reads,2);const i=f.b.writes[0];assert.equal(i.setup.entryMode,'independent_breakout');assert.ok(i.order.stopLoss>0);assert.ok(i.order.takeProfit>0);assert.equal(f.state.checks.AAPL.entryDecisions.current.ready,false);assert.equal(f.state.checks.AAPL.entryDecisions.selected,'independent_breakout');
 await runCycle({...f.args,now:()=>now+60000,deadline:now+87000});assert.equal(f.b.writes.length,1);
});
test('default route, account blockers, insufficient cash and final invalidation never submit a breakout',async()=>{
 for(const kind of ['disabled','halt','cash','permission','history','changed-signal','changed-price','new-order','save']){
  const f=fixture();
  if(kind==='disabled')f.args.env={...env,COLMEX_INDEPENDENT_BREAKOUT_ENABLED:'false'};
  if(kind==='halt')f.state.halt='UNRESOLVED_ORDER_REQUIRES_REVIEW';
  if(kind==='cash')f.b.snapshot=async()=>({...f.snapshot(),state:{availableCash:1}});
  if(kind==='permission')f.b.snapshot=async()=>({...f.snapshot(),account:{tradingRules:{}}});
  if(kind==='history')f.b.snapshot=async()=>({...f.snapshot(),historyAvailable:false});
  if(kind==='changed-signal')f.b.history=async()=>{const h=f.history();if(++f.b.reads>1)h.barDetails.at(-2).c=100.6;return h;};
  if(kind==='changed-price'){let q=0;f.b.quote=async()=>++q===1?{bp:101.2,ap:101.21}:{bp:100,ap:100.01};}
  if(kind==='new-order'){let r=0;f.b.snapshot=async()=>({...f.snapshot(),orders:++r>1?[{id:'external',tradableInstrumentId:1,side:'buy'}]:[]});}
  if(kind==='save')f.args.save=async s=>{if(s.pending)throw Error('durability');};
  if(kind==='save')await assert.rejects(runCycle(f.args),/durability/);else await runCycle(f.args);
  assert.equal(f.b.writes.length,0,kind);
 }
});
