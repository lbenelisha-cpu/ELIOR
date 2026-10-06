import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const start=source.indexOf('function candidateBlocker('),end=source.indexOf('function weakestHeldEvaluation(',start);
const context={tradingPositions:()=>({}),ENTRY_MIN_SCORE:72,ENTRY_MAX_RUN_PCT:4.5,ENTRY_TRIGGER_PCT:2,MAX:10,ROTATION_ENABLED:false};
vm.createContext(context);vm.runInContext(source.slice(start,end),context);
const ev={ok:true,symbol:'ACEUSDT',buyQualified:true,score:90,entryGainPct:1,entryConfirmed:false};
test('trend qualification does not bypass score, confirmation or anti-chase',()=>{
 assert.equal(context.candidateBlocker({...ev,score:65},[]).code,'WAIT_SCORE');
 assert.equal(context.candidateBlocker(ev,[]).code,'WAIT_PLUS_2');
 assert.equal(context.candidateBlocker({...ev,entryGainPct:5},[]).code,'ANTI_CHASE');
 assert.equal(context.candidateBlocker({...ev,entryGainPct:2,entryConfirmed:true},[]).code,'BUY_READY');
 assert.equal(context.candidateBlocker({...ev,entryGainPct:2,entryCost:{ok:false,code:'WAIT_SPREAD',text:'wide'}},[]).code,'WAIT_SPREAD');
});
test('full portfolio never advertises rotation when rotation is disabled',()=>{
 context.tradingPositions=()=>Object.fromEntries(Array.from({length:10},(_,i)=>['S'+i,{}]));
 assert.equal(context.candidateBlocker({...ev,entryConfirmed:true,entryGainPct:2},[]).code,'NO_SLOT');
});
