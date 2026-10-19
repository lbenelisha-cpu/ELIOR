import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
function storage(){const values=new Map(),c=vm.createContext({window:{},localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}});vm.runInContext(read('binance-control-session.js'),c);return c.window.LEVI_TRADE_AUTH;}
test('pairing is saved before any trade and survives a subsequent business rejection without another code',async()=>{
 const auth=storage(),calls=[],token='device-'+'a'.repeat(64);let rejectTrade=false;
 const c=vm.createContext({window:{LEVI_TRADE_AUTH:auth},B:'https://example.test',tradeControlToken:null,J:async(url,options)=>{calls.push({url,...options});if(url.endsWith('/session'))return {ok:true,token,expiresAt:'2027-01-01'};if(rejectTrade)throw Object.assign(Error('NO_CASH'),{status:400});return {ok:true};}});
 const source=read('binance-agent.js');vm.runInContext(source.slice(source.indexOf('async function authenticatedControl('),source.indexOf('async function setMode(')),c);vm.runInContext(source.slice(source.indexOf('window.LEVI_MANUAL_TRADES={')),c);
 await c.window.LEVI_MANUAL_TRADES.pair('012345');assert.equal(calls.length,1);assert(calls[0].url.endsWith('/session'));assert.equal(auth.read(),token);assert.equal(c.tradeControlToken,token);
 rejectTrade=true;const result=await c.window.LEVI_MANUAL_TRADES.submit({side:'SELL'});assert.equal(result.ok,false);assert.equal(auth.read(),token);assert.equal(calls[1].headers.Authorization,'Bearer '+token);
 assert.doesNotMatch(source,/prompt\(/);
});
test('disconnected trade click opens device setup without submitting a buy or sell',()=>{
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{disabled:false,hidden:false,open:false,addEventListener(){}});return elements.get(id);};let connects=0,orders=0;
 const c=vm.createContext({document:{getElementById:get},window:{LEVI_MANUAL_TRADES:{context:()=>({mode:'live',symbol:'BNBUSDT',capabilities:{version:1},account:{balances:[{asset:'BNB',free:1}]}}),connected:()=>false,connect:()=>connects++,submit:()=>orders++}},setInterval(){}});
 vm.runInContext(read('binance-manual-trades.js'),c);get('manualSellBtn').onclick();get('manualBuyBtn').onclick();assert.equal(connects,2);assert.equal(orders,0);
});
test('connecting a device never replays the trade button and preserves six-digit leading zero',async()=>{
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false,disabled:false,open:false,focus(){},showModal(){this.open=true;},close(){this.open=false;},addEventListener(){}});return elements.get(id);};const codes=[];let orders=0,connected=false;
 const c=vm.createContext({document:{getElementById:get},window:{LEVI_MANUAL_TRADES:{connected:()=>connected,pair:async code=>{codes.push(code);connected=true;},submit:()=>orders++}},setInterval(){}});
 vm.runInContext(read('binance-device-access.js'),c);get('manualConnectBtn').onclick();get('devicePairCode').value='012345';await get('devicePairSubmit').onclick();assert.deepEqual(codes,['012345']);assert.equal(orders,0);assert.equal(get('deviceConnectionDialog').open,false);assert.equal(get('manualConnectBtn').hidden,true);
});
