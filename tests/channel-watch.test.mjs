import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../channel-watch.js',import.meta.url),'utf8');
const ctx=vm.createContext({});vm.runInContext(code,ctx);const candidate=ctx.LEVI_CHANNEL_WATCH.candidate;
const now=Date.now(),base={at:now,now,enabled:true};
test('only advanced channel stages qualify, separately for LONG and SHORT',()=>{
 for(const reason of ['WAIT_CHANNEL_BREAKOUT','CHANNEL_VOLUME_LOW','WAIT_LOWER_CHANNEL_BREAK','SHORT_VOLUME_LOW'])assert.ok(candidate({...base,reason}));
 for(const reason of ['WAIT_CHANNEL_PIVOTS','REGRESSION_DIRECTION_BLOCK','SHORT_PRICE_INVALIDATED','CHANNEL_SIGNAL_EXPIRED','WAIT_NEW_SHORT_SIGNAL','CHANNEL_BREAKOUT_READY','SHORT_CHANNEL_READY','CHANNEL_LIQUIDITY_LOW',null])assert.equal(candidate({...base,reason}),null);
});
test('held, disabled, stale, missing, future and expired results never highlight',()=>{
 const x={...base,reason:'WAIT_CHANNEL_BREAKOUT'};
 for(const patch of [{held:true},{enabled:false},{stale:true},{at:null},{at:undefined},{at:now+1},{at:now-60000}])assert.equal(candidate({...x,...patch}),null);
 assert.ok(candidate({...x,at:new Date(now).toISOString()}));
});
test('a network stall expires the animation without another server response',()=>{
 let tick,removed=false;const badge={dataset:{watchExpires:now-1},classList:{remove(){}},closest:()=>({classList:{remove:()=>removed=true}}),removeAttribute(){}};
 const c=vm.createContext({setInterval:fn=>tick=fn,document:{querySelectorAll:()=>[badge],addEventListener(){}}});vm.runInContext(code,c);tick();assert.ok(removed);assert.match(badge.textContent,/נדרש עדכון/);
});
test('SHORT scan rows reuse the classifier and suppress highlighting for open positions',()=>{
 vm.runInContext(fs.readFileSync(new URL('../binance-futures-positions.js',import.meta.url),'utf8'),ctx);
 const x={mode:'live',shortTrading:{enabled:true,checkedAt:now,positions:[],checks:{ABCUSDT:{at:now,reason:'WAIT_LOWER_CHANNEL_BREAK'}}}};
 assert.match(ctx.LEVI_FUTURES_TABLE.view(x,now),/class="channel-watch"/);
 x.shortTrading.positions=[{symbol:'ABCUSDT'}];assert.doesNotMatch(ctx.LEVI_FUTURES_TABLE.view(x,now),/class="channel-watch"/);
});
