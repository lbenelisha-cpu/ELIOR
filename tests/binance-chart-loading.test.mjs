import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const src=fs.readFileSync(new URL('../binance-agent.js',import.meta.url),'utf8');
const block=src.slice(src.indexOf('let chartLoadInFlight='),src.indexOf('\nfunction drawIndicators(',src.indexOf('let chartLoadInFlight=')));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness(){
 const scan=deferred(),events=[],labels={},empty={hidden:true};let requests=0;const data={candles:[{closeTime:1,closed:true,close:50}],decisions:[],actions:[],decisionMode:'live'};
 const ctx=vm.createContext({selectedSymbol:'BTCUSDT',selectedInterval:'5m',selectedRange:'1W',currentMode:'live',chartRequestId:0,chartAnalysisContext:null,selectedWyckoffId:null,chartWyckoffHistory:[],chartWyckoffError:null,chartVisibleStartTime:0,chartCandles:[],chartDecisions:[],currentAgentData:{agents:[]},wyckoffHistoryCache:new Map(),CHART:'/chart',
  wyckoffHistoryEngine:{mergeBinanceRecorded:history=>history},
  J:async(url,options)=>{requests++;assert.equal(options.timeoutMs,35000);return data;},
  runBinanceWyckoffScan:()=>scan.promise,
  drawCandles:bars=>events.push({kind:'draw',count:bars.length}),renderCandlePower:()=>events.push({kind:'power'}),
  put:(id,value)=>{labels[id]=value;},$:id=>id==='#chartEmpty'?{classList:{add(){empty.hidden=true;},remove(){empty.hidden=false;}}}:id==='#chartDecisionMarkers'?{replaceChildren(){}}:id==='#priceChart'?{width:600}:null,
  encodeURIComponent,Error,Map,Number});
 vm.runInContext(block,ctx);return {ctx,scan,events,labels,empty,data,get requests(){return requests;}};
}
test('refreshes share pending chart request and candles draw before a slow annotation worker',async()=>{
 const h=harness();const first=h.ctx.loadChart('BTCUSDT');await new Promise(setImmediate);
 assert.equal(h.requests,1);assert.equal(h.events[0].kind,'draw');assert.equal(h.events[0].count,1);
 const second=h.ctx.loadChart('BTCUSDT');assert.equal(first,second);assert.equal(h.requests,1);
 h.scan.resolve({history:[],error:null});await first;assert.equal(h.ctx.chartRequestId,1);
});
test('changing asset starts its own load and an older completion cannot overwrite it',async()=>{
 const h=harness(),firstData=deferred(),secondData=deferred();let calls=0;
 h.ctx.J=()=>++calls===1?firstData.promise:secondData.promise;
 const a=h.ctx.loadChart('BTCUSDT');h.ctx.selectedSymbol='ETHUSDT';const b=h.ctx.loadChart('ETHUSDT');
 secondData.resolve({...h.data,candles:[{closeTime:2,closed:true,close:100}]});h.scan.resolve({history:[],error:null});await b;
 firstData.resolve(h.data);await a;assert.equal(h.ctx.chartCandles[0].close,100);assert.equal(calls,2);
});
test('same-asset refresh failure retains visible candles with an explicit stale-data message',async()=>{
 const h=harness();h.scan.resolve({history:[],error:null});await h.ctx.loadChart('BTCUSDT');h.ctx.J=async()=>{throw Error('timeout');};await h.ctx.loadChart('BTCUSDT');
 assert.equal(h.ctx.chartCandles.length,1);assert.match(h.labels['#chartLegend'],/מהטעינה האחרונה/);assert.equal(h.empty.hidden,true);
});
test('empty responses display a reason instead of leaving a blank chart',async()=>{
 const h=harness();h.ctx.J=async()=>({candles:[]});await h.ctx.loadChart('BTCUSDT');assert.equal(h.empty.hidden,false);assert.match(h.labels['#chartEmpty'],/לא התקבלו נרות/);assert.equal(h.events.length,0);
});
