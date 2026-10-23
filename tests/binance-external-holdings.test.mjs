import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../binance-agent.js',import.meta.url),'utf8');
const ctx=vm.createContext({});vm.runInContext(source.slice(source.indexOf('function activeContext('),source.indexOf('function selectScannerAsset(')),ctx);
test('verified account holdings outside the scanner appear once without inventing an automated trade',()=>{
 const d={agents:[{symbol:'BTCUSDT',position:'CASH',strategy:{price:100}}]},account={connected:true,balances:[{asset:'BRKBB',valueUsdt:140,usdtPrice:548,qty:.25},{asset:'BTC',valueUsdt:10},{asset:'USDT',valueUsdt:20},{asset:'DUST',valueUsdt:.2}]};
 const view=ctx.activeContext(d,'live',account);assert.equal(view.agents.length,2);assert.equal(view.activeAgents.length,2);
 const a=view.agents.find(a=>a.symbol==='BRKBBUSDT');assert.equal(a.accountOnly,true);assert.equal(a.strategy.price,548);assert.equal(a.entryConfirmed,false);assert.equal(a.strategy.entryPrice,undefined);assert.equal(a.strategy.stopPrice,undefined);
 assert.equal(d.agents.length,1);assert.equal(ctx.activeContext({...d,agents:view.agents},'live',account).agents.length,2);
});
test('unverified accounts and demo never synthesize external holdings; sold holdings disappear',()=>{
 const d={agents:[]},balances=[{asset:'EXT',valueUsdt:20}];
 assert.equal(ctx.activeContext(d,'live',{balances}).agents.length,0);
 assert.equal(ctx.activeContext(d,'demo',{connected:true,balances}).agents.length,0);
 assert.equal(ctx.activeContext(d,'live',{connected:true,balances:[]}).agents.length,0);
});
