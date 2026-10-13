import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const block=source.slice(source.indexOf('    const entryActions='),source.indexOf('    if(!p&&ev.entryConfirmed){',source.indexOf('    const entryActions=')));
for(const mode of ['live','demo'])test(mode+' requires a signal after the last sale even with a different pattern',()=>{
 for(const [signal,expected] of [[999,false],[1000,false],[1001,true]]){
 const log=[{type:'SELL',symbol:'BTCUSDT',at:new Date(1000).toISOString()},{type:'SELL',symbol:'ETHUSDT',at:new Date(2000).toISOString()}];
 const ev={entryConfirmed:true,entryEligible:true,rawDecision:'BUY',buyQualified:true,wyckoffTrade:{patternId:'different'},strategy:{buyConfirmed:true,wyckoff:{signalTime:signal}}};
 const context={mode,DEMO_TRADING:true,liveActionLog:log,demoTrader:{state:{actionLog:log}},paper:{actionLog:log},s:'BTCUSDT',p:null,tradeControl:{paused:false},ev};
 vm.createContext(context);vm.runInContext(block,context);assert.equal(ev.entryConfirmed,expected);assert.equal(ev.strategy.buyConfirmed,expected);
 }
});
