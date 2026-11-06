import test from 'node:test';
import assert from 'node:assert/strict';
import {channelEntryConfig,channelEntry} from '../lib/channel-primary-entry.mjs';
import {shortSignal} from '../lib/futures-short-policy.mjs';
import {colmexChannelSignal,assertColmexChannelSubmission} from '../lib/colmex-channel-entry.mjs';
import {applyColmexExitPolicy,colmexPositionExit} from '../lib/colmex-position-exit.mjs';
import {initialState,runCycle} from '../lib/colmex-auto-runner.mjs';
import {reconcile,closureEvidence} from '../lib/colmex-reconciliation.mjs';
import {AUTO_POLICY,LIVE_ACK,planShort} from '../lib/colmex-auto-policy.mjs';
import {regularSession} from '../lib/colmex-market-hours.mjs';
const D=300000,end=Date.parse('2026-10-30T15:00:00Z'),now=end+1000;
const env={CONTEXT:'production',COLMEX_AUTO_LIVE_ENABLED:'true',COLMEX_AUTO_LIVE_ACK:LIVE_ACK,COLMEX_AUTO_ACCOUNT_ID:'123',COLMEX_CHANNEL_PRIMARY_ENABLED:'true',COLMEX_CHANNEL_PRIMARY_AFTER:new Date(end-D).toISOString()};
const config=channelEntryConfig(env,'COLMEX');
function input(short=true){
 let times=[];for(let t=end-8*86400000;t<end;t+=D)if(regularSession(t))times.push(t);
 const bars=times.slice(-205).map((t,i)=>{const rising=100+i*.02+Math.cos(i*Math.PI/5),p=short?210-rising:rising;return {openTime:t,closeTime:t+D,open:p,close:p,high:p+.1,low:p-.1,volume:1000,closed:true};});
 // A completed central consolidation precedes the live breakout.
 for(const [j,bar] of bars.slice(-3).entries()){const p=(short?105.95:104.05)+(j===1?.01:0);Object.assign(bar,{open:p,close:p,high:p+.1,low:p-.1});}
 const price=short?104:106;
 return {symbol:'AAPL',bars,price,ask:price+.01,priceAsOf:now,now,liveBar:{openTime:end,closeTime:end+D,open:105,close:price,high:short?105.1:106.1,low:short?103.9:104.9,volume:2000,closed:false,receivedAt:now}};
}
const details={quotingCurrency:'USD',symbolStatus:'FULLY_OPEN',tickSize:[{leftRangeLimit:0,tickSize:.01}],lotStep:1,lotSize:1,minLot:1,maxLot:1000};
function fixture(){
 const i=input(),state=initialState(end-D);state.cursor=AUTO_POLICY.symbols.indexOf('AAPL');
 const snapshot=()=>({account:{tradingRules:{supportSelfTrading:true,supportBrackets:true}},state:{availableCash:2000},positions:[],orders:[],history:[],historyAvailable:true});
 let historyReads=0,quoteReads=0;
 const broker={writes:[],snapshot:async()=>snapshot(),instruments:async()=>[{name:'AAPL',type:'EQUITY',tradableInstrumentId:1}],details:async()=>details,
 quote:async()=>{quoteReads++;return {bp:i.price,ap:i.ask};},history:async()=>{historyReads++;return {barDetails:[...i.bars,i.liveBar].map(b=>({t:b.openTime,o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume}))};},
 write:async(a,intent)=>{broker.writes.push(structuredClone(intent));return {orderId:'offline'};}};
 const args={state,broker,env:{...env},now:()=>now,deadline:now+27000,save:async()=>{}};
 return {i,state,broker,args,snapshot,reads:()=>({historyReads,quoteReads})};
}
test('Colmex shares Binance LONG and SHORT geometry, volume and target conditions',()=>{
 for(const short of [false,true]){
  const i=input(short),r=colmexChannelSignal(i,config),b=short?shortSignal({...i,price:i.ask},config):channelEntry(i,config);
  assert.equal(r.ready,true,r.reason);assert.equal(r.side,short?'SHORT':'LONG');
  for(const k of ['level','regressionCenter','regressionSlope','targetPrice','volumeRatio','meanDollarVolume','lowTouches','highTouches'])assert.equal(r.setup[k],b.setup[k],k);
  assert.doesNotThrow(()=>assertColmexChannelSubmission(i,config,{setup:r.setup,patternId:r.setup.patternId}));
  assert.equal(colmexChannelSignal({...i,used:[r.setup.patternId]},config).ready,false);
  assert.equal(colmexChannelSignal({...i,liveBar:{...i.liveBar,volume:1}},config).ready,false);
  assert.equal(colmexChannelSignal({...i,priceAsOf:now-11000},config).ready,false);
 }
 const i=input();assert.equal(colmexChannelSignal({...i,ask:110},config).ready,false,'a low Bid is insufficient when Ask has not broken');
 assert.equal(colmexChannelSignal(i,{...config,enabled:false}).ready,false);
});
test('protected SHORT is rechecked, durably reserved once and not duplicated after restart',async()=>{
 const f=fixture();await runCycle(f.args);
 assert.equal(f.broker.writes.length,1,JSON.stringify(f.state.checks));
 const order=f.broker.writes[0];assert.equal(order.order.side,'sell');assert.equal(order.setup.entryMode,'channel_short');assert.equal(order.order.takeProfitType,'absolute');assert.ok(order.order.takeProfit<order.order.price);assert.equal(order.order.stopLossType,'offset%');
 assert.equal(f.reads().historyReads,2);assert.equal(f.reads().quoteReads,2);
 await runCycle({...f.args,state:structuredClone(f.state),now:()=>now+60000,deadline:now+87000});assert.equal(f.broker.writes.length,1);
});
test('Colmex blocks a stale candidate when consolidation changes before the broker write',async()=>{
 const f=fixture(),history=f.broker.history;let calls=0;
 f.broker.history=async()=>{
  const h=await history();
  if(++calls===2)for(let k=202;k<205;k++){const p=210-(100+k*.02+Math.cos(k*Math.PI/5));Object.assign(h.barDetails[k],{o:p,c:p,h:p+.1,l:p-.1});}
  return h;
 };
 await runCycle(f.args);assert.equal(f.broker.writes.length,0);
 assert.ok(JSON.stringify(f.state).includes('CHANNEL_CONSOLIDATION_SIDE_BLOCK'),JSON.stringify(f.state));
});
test('SHORT final recheck blocks changed geometry, price, low volume, expired data, lack of cash and slots',async()=>{
 for(const kind of ['price','volume','expiry','cash','slots','permission','save']){
  const f=fixture(),history=f.broker.history,quote=f.broker.quote;let reads=0;
  if(kind==='volume')f.broker.history=async()=>{const h=await history();if(++reads===2)h.barDetails.at(-1).v=1;return h;};
  if(kind==='price')f.broker.quote=async()=>++reads===2?{bp:110,ap:110.01}:quote();
  if(kind==='expiry'){let at=now;f.args.now=()=>at;f.args.save=async s=>{if(s.pending)at=end+D;};}
  if(kind==='cash')f.broker.snapshot=async()=>({...f.snapshot(),state:{availableCash:1}});
  if(kind==='slots')f.broker.snapshot=async()=>({...f.snapshot(),orders:[1,2,3].map(n=>({id:n,tradableInstrumentId:n+10,side:'sell'}))});
  if(kind==='permission')f.broker.snapshot=async()=>({...f.snapshot(),account:{tradingRules:{}}});
  if(kind==='save')f.args.save=async s=>{if(s.pending)throw Error('STORAGE');};
  await runCycle(f.args).catch(e=>assert.equal(e.message,'STORAGE'));assert.equal(f.broker.writes.length,0,kind);
 }
});
test('SHORT partial fills retain direction, use buy-side closure proof and report positive profit on falling prices',async()=>{
 const f=fixture();await runCycle(f.args);const intent=f.state.pending;
 const position={id:'pos',tradableInstrumentId:1,side:'sell',qty:2,avgPrice:104,stopLoss:105.04,takeProfit:intent.order.takeProfit};
 const history=[{id:'offline',positionId:'pos',side:'sell',status:'filled',filledQty:2,avgPrice:104}];
 reconcile(f.state,{...f.snapshot(),positions:[position],history},now+1000);
 assert.equal(f.state.pending,null);assert.equal(f.state.positions[0].side,'SHORT');assert.equal(f.state.positions[0].qty,2);assert.equal(f.state.halt,null);
 const close={id:'cover',positionId:'pos',side:'buy',status:'filled',filledQty:2,avgPrice:100};
 assert.equal(closureEvidence([close],'pos',2),null);assert.equal(closureEvidence([close],'pos',2,'SHORT').exitPrice,100);
 reconcile(f.state,{...f.snapshot(),history:[...history,close]},now+2000);assert.equal(f.state.closedTrades[0].grossPnl,8);assert.equal(f.state.closedTrades[0].side,'SHORT');
});
test('SHORT trailing stop moves down only and tighter broker protection is acknowledged',()=>{
 const p={side:'SHORT',entryPrice:100,setup:{targetPrice:80},targetPrice:80,exitSettings:{stopLossPct:1,profitActivationPct:5,trailingGapPp:1}};
 applyColmexExitPolicy(p);assert.equal(p.effectiveStopPrice,101);
 assert.equal(colmexPositionExit(p,94,now).sell,false);assert.equal(p.effectiveStopPrice,95);
 assert.equal(colmexPositionExit(p,94.5,now).sell,false);assert.equal(p.effectiveStopPrice,95);
 assert.equal(colmexPositionExit(p,95,now).sell,true);
 const s=initialState(now);s.positions=[{...p,id:'pos',symbol:'AAPL',instrumentId:1,qty:2,tickSize:details.tickSize}];s.pending={id:'protect',at:now,kind:'PROTECTION',symbol:'AAPL',positionId:'pos',stopLoss:95,takeProfit:80};
 reconcile(s,{positions:[{id:'pos',tradableInstrumentId:1,qty:2,avgPrice:100,side:'sell',stopLoss:94.8,takeProfit:80}],orders:[],history:[]},now+1);assert.equal(s.pending,null);assert.equal(s.halt,null);
});
test('existing SHORT is managed at Ask even when entry route is disabled',async()=>{
 const f=fixture();f.args.env.COLMEX_CHANNEL_PRIMARY_ENABLED='false';
 f.state.positions=[applyColmexExitPolicy({id:'pos',symbol:'AAPL',side:'SHORT',instrumentId:1,qty:2,entryPrice:100,targetPrice:90,setup:{targetPrice:90},tickSize:details.tickSize,strategyId:'WYCKOFF_5M_V1'})];
 f.broker.snapshot=async()=>({...f.snapshot(),positions:[{id:'pos',tradableInstrumentId:1,side:'sell',qty:2,avgPrice:100,stopLoss:101,takeProfit:90}]});
 f.broker.quote=async()=>({bp:100.9,ap:101.1});await runCycle(f.args);
 assert.equal(f.broker.writes.length,1);assert.equal(f.broker.writes[0].kind,'CLOSE');assert.equal(f.broker.writes[0].positionId,'pos');
});
