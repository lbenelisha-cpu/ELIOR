import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const start=source.indexOf('function candidateBlocker('),end=source.indexOf('function weakestHeldEvaluation(',start);
const context={TRAILING_EXIT_POLICY:'PROFIT_FLOOR4_TRAIL1PP_STOP1_V1',mode:'demo',LIVE_MAX_POSITIONS:5,tradingPositions:()=>({}),ENTRY_MIN_SCORE:72,ENTRY_MAX_RUN_PCT:4.5,ENTRY_TRIGGER_PCT:2,MAX:10,ROTATION_ENABLED:false};
vm.createContext(context);vm.runInContext(source.slice(start,end),context);
const ev={ok:true,symbol:'ACEUSDT',buyQualified:true,score:90,entryGainPct:1,entryConfirmed:false};
test('only completed Wyckoff sequence can advertise entry readiness',()=>{
 assert.equal(context.candidateBlocker({...ev,buyReason:'SPRING'},[]).code,'SPRING');
 assert.equal(context.candidateBlocker({...ev,entryConfirmed:true},[]).code,'BUY_READY');
 assert.equal(context.candidateBlocker({...ev,ok:false,error:'WAIT_DAILY_BARS'},[]).code,'WAIT_DAILY_BARS');
 assert.equal(context.candidateBlocker({...ev,demoTradable:false},[]).code,'NOT_DEMO_TRADABLE');
});
test('full portfolio never advertises rotation when rotation is disabled',()=>{
 context.tradingPositions=()=>Object.fromEntries(Array.from({length:10},(_,i)=>['S'+i,{}]));
 assert.equal(context.candidateBlocker({...ev,entryConfirmed:true,entryGainPct:2},[]).code,'NO_SLOT');
});

test('active holding refers to configured trailing protection',()=>{
 const result=context.candidateBlocker({...ev,position:'LONG',strategy:{strategyId:'WYCKOFF_5M_V1',exitPolicy:'PROFIT_FLOOR4_TRAIL1PP_STOP1_V1',entryMode:'spring_rsi_live'}},[]);
 assert.equal(result.code,'ACTIVE_LONG');assert.match(result.text,/SETTINGS/);assert.match(result.text,/אינו יורד/);assert.match(result.text,/נגרר/);
});
