import test from 'node:test';
import assert from 'node:assert/strict';
import {compactChartResponse} from '../lib/binance-chart-response.mjs';
import {createReadProxy} from '../netlify/functions/binance-read-proxy.mjs';
import {channelEntry,channelEntryConfig} from '../lib/channel-primary-entry.mjs';
import {pocFixture} from './helpers/poc-channel-fixture.mjs';
import {mergeBinanceRecorded} from '../lib/binance-wyckoff-history.mjs';

const event=path=>({httpMethod:'GET',queryStringParameters:{path},headers:{authorization:'Bearer '+'a'.repeat(40)}});
function snapshot(){
 const input=pocFixture(),policy=channelEntryConfig({BINANCE_CHANNEL_PRIMARY_ENABLED:'true',BINANCE_CHANNEL_PRIMARY_AFTER:new Date(input.now-300000).toISOString()});
 const result=channelEntry(input,policy);assert.ok(result.conditions.model);
 const row={at:new Date(input.now).toISOString(),firstAt:new Date(input.now-10000).toISOString(),checks:3,mode:'live',symbol:'TRXUSDT',price:input.price,decision:'HOLD',reason:'WAIT_POC_RETEST',analysisSignal:false,entryConfirmed:false,entryDecisions:{channel:{conditions:result.conditions}}};
 return {ok:true,symbol:'TRXUSDT',interval:'5m',range:'1W',visibleStartTime:input.now-7*86400000,candles:input.bars,decisionMode:'live',decisions:Array.from({length:2000},(_,i)=>({...row,at:new Date(input.now-i*5000).toISOString()})),actions:[{at:row.at,type:'BUY',price:input.price,mode:'live',wyckoffTrade:{setup:{pocModel:result.conditions.model,signalTime:input.now}}}]};
}
test('a realistic POC journal exceeding the function limit fits without dropping candles or historical rows',async()=>{
 const source=snapshot(),before=JSON.stringify(source);assert.ok(Buffer.byteLength(before)>6_000_000);
 let options;
 const proxy=createReadProxy(async(_,o)=>{options=o;return {status:200,headers:new Headers({'content-type':'application/json'}),json:async()=>source};});
 const response=await proxy(event('/api/binance-chart?symbol=TRXUSDT&interval=5m&range=1W'));
 assert.equal(response.statusCode,200);assert.equal(response.headers['Cache-Control'],'no-store');
 // Measure the serialized Lambda envelope too, including JSON-string escaping.
 assert.ok(Buffer.byteLength(JSON.stringify(response))<1_000_000);
 const data=JSON.parse(response.body);assert.deepEqual(data.candles,source.candles);assert.equal(data.decisions.length,2000);assert.equal(data.actions.length,1);
 assert.deepEqual(data.decisions.map(r=>[r.at,r.checks,r.price,r.reason]),source.decisions.map(r=>[r.at,r.checks,r.price,r.reason]));
 assert.equal(data.actions[0].type,'BUY');assert.equal(data.actions[0].price,source.actions[0].price);
 assert.equal(data.decisionMode,'live');assert.equal(data.visibleStartTime,source.visibleStartTime);
 assert.equal(options.headers.Authorization,event('').headers.authorization);assert.equal(options.method,'GET');
 assert.equal(JSON.stringify(source),before,'stored execution evidence must remain untouched');
});
test('recorded Wyckoff markers retain pivot prices, times and confirmation through both historical shapes',()=>{
 const now=Date.now(),setup={phase:'SPRING',requireHigherRecovery:true,recoveryComparison:{passed:true,reason:'HIGHER_RECOVERY'},rsiCloses:[1,2,3],pocModel:{profile:{bins:Array(128).fill(1)}}};
 for(const [i,key] of ['initialPeak','firstLow','rallyHigh','secondaryTest','secondRallyHigh','springLow','confirmation'].entries())setup[key]={time:now-(7-i)*300000,price:10+i,index:i};
 const decisions=[{at:new Date(now).toISOString(),analysisSignal:true,setup}],actions=[{at:new Date(now).toISOString(),type:'BUY',price:16,wyckoffTrade:{setup}}];
 const result=compactChartResponse({ok:true,candles:[],decisions,actions});
 const before=mergeBinanceRecorded([],decisions.concat(actions),{},now),after=mergeBinanceRecorded([],result.decisions.concat(result.actions),{},now);
 assert.equal(after.length,1);assert.equal(after[0].id,before[0].id);assert.equal(after[0].confirmedAt,before[0].confirmedAt);assert.equal(after[0].springAt,before[0].springAt);
 for(const key of ['initialPeak','firstLow','rallyHigh','secondaryTest','secondRallyHigh','springLow','confirmation'])assert.deepEqual(after[0].setup[key],setup[key]);
 assert.deepEqual(after[0].setup.recoveryComparison,setup.recoveryComparison);
 assert.equal(after[0].setup.rsiCloses,undefined);assert.equal(after[0].setup.pocModel,undefined);
});
test('only successful chart responses are projected; live state and authentication errors remain unchanged',async()=>{
 const source={ok:true,candles:[],decisions:[{at:'today',entryDecisions:{channel:{model:{id:'execution-evidence'}}}}]};
 const proxy=createReadProxy(async()=>({status:200,headers:new Headers({'content-type':'application/json'}),json:async()=>source}));
 assert.deepEqual(JSON.parse((await proxy(event('/api/binance-agent'))).body),source);
 const denied={ok:false,error:'Authentication required'};
 const auth=createReadProxy(async()=>({status:401,headers:new Headers({'content-type':'application/json'}),json:async()=>denied}));
 const response=await auth(event('/api/binance-chart?symbol=TRXUSDT'));assert.equal(response.statusCode,401);assert.deepEqual(JSON.parse(response.body),denied);
 assert.equal(compactChartResponse(denied),denied);
});
