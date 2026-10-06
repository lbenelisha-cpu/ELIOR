import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
function setup(){
 const sockets=[],timers=[];
 class Socket{
  static OPEN=1;static CONNECTING=0;
  constructor(url){this.url=url;this.readyState=0;this.handlers={};sockets.push(this);}
  on(event,fn){this.handlers[event]=fn;}
  close(){this.readyState=3;}
 }
 const context={WebSocket:Socket,SYMBOLS:['ACEUSDT'],streams:{ACEUSDT:{status:'starting'}},marketSocket:null,setTimeout:fn=>(timers.push(fn),{unref(){}})};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function startMarketStream(){'),source.indexOf('async function fetchHistoricalDaily(')),context);
 return {context,sockets,timers};
}
test('unchanged universe reuses both connecting and connected subscriptions',()=>{
 const x=setup();x.context.startMarketStream();x.context.startMarketStream();assert.equal(x.sockets.length,1);
 x.sockets[0].readyState=1;x.sockets[0].handlers.open();x.context.startMarketStream();assert.equal(x.sockets.length,1);
 assert.equal(x.context.streams.ACEUSDT.status,'connected');
});
test('old close, open and message callbacks cannot poison a replacement stream',()=>{
 const x=setup();x.context.startMarketStream();const old=x.sockets[0];
 x.context.SYMBOLS.push('UMAUSDT');x.context.streams.UMAUSDT={};x.context.startMarketStream();const current=x.sockets[1];
 current.readyState=1;current.handlers.open();old.handlers.close();old.handlers.open();
 old.handlers.message(JSON.stringify({s:'ACEUSDT',p:'999',E:Date.now()}));
 assert.equal(x.context.streams.ACEUSDT.status,'connected');assert.equal(x.context.streams.ACEUSDT.lastPrice,undefined);assert.equal(x.timers.length,0);
 current.handlers.message(JSON.stringify({s:'ACEUSDT',p:'0.2',E:Date.now()}));assert.equal(x.context.streams.ACEUSDT.lastPrice,.2);
});
test('only the current disconnected socket schedules one reconnect',()=>{
 const x=setup();x.context.startMarketStream();const socket=x.sockets[0];socket.readyState=3;socket.handlers.close();
 assert.equal(x.timers.length,1);assert.equal(x.context.streams.ACEUSDT.status,'disconnected');x.timers[0]();assert.equal(x.sockets.length,2);
 socket.handlers.close();assert.equal(x.timers.length,1);
});
test('failed evaluation clears old buy eligibility instead of advertising stale candidates',()=>{
 const context={agents:{ACEUSDT:{position:'CASH',decision:'BUY_READY',entryConfirmed:true,entryEligible:true,buyQualified:true}}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function setAgentFromEval('),source.indexOf('function decisionReasonFromAgent(')),context);
 context.setAgentFromEval({ok:false,symbol:'ACEUSDT',error:'Fresh connected Binance price required; entry evaluation paused'});
 const a=context.agents.ACEUSDT;assert.equal(a.entryConfirmed,false);assert.equal(a.entryEligible,false);assert.equal(a.buyQualified,false);assert.equal(a.decision,'WAIT_DATA');assert.equal(a.staleData,true);
});
