import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
function harness({token='a'.repeat(40),mode='demo',failure=null,confirm=true}={}){
 const source=fs.readFileSync(new URL('../binance-agent.js',import.meta.url),'utf8'),calls=[],alerts=[];let connections=0,loads=0;
 const context=vm.createContext({window:{LEVI_DEVICE_ACCESS:{open(){connections++;},refresh(){}}},MODE:'/mode',TRADE_CONTROL:'/control',tradeControlToken:token?.length>=32?token:null,
  prompt:()=>{throw Error('No password prompt is allowed');},confirm:()=>confirm,alert:x=>alerts.push(x),load:async()=>{loads++;},J:async(url,options)=>{if(!options)return {mode};calls.push({url,...options});if(failure)throw Error(failure);return {ok:true};}});
 vm.runInContext(source.slice(source.indexOf('async function authenticatedControl('),source.indexOf('async function sendTradeControl(')),context);
 return {calls,alerts,get connections(){return connections;},get loads(){return loads;},run:code=>vm.runInContext(code,context)};
}
test('both mode transitions reuse saved device authorization without a password prompt',async()=>{
 for(const [mode,target] of [['demo','live'],['live','demo']]){const h=harness({mode});await h.run(`setMode('${target}')`);assert.equal(h.calls[0].headers.Authorization,'Bearer '+'a'.repeat(40));assert.equal(JSON.parse(h.calls[0].body).mode,target);assert.equal(h.loads,1);await h.run("authenticatedControl(TRADE_CONTROL,{action:'start'})");assert.equal(h.connections,0);assert.equal(h.calls[1].headers.Authorization,h.calls[0].headers.Authorization);}
});
test('disconnected devices open setup without sending any control mutation',async()=>{
 for(const options of [{token:null},{token:'short'},{confirm:false}]){const h=harness(options);await h.run("setMode('live')");assert.equal(h.calls.length,0);assert.equal(h.loads,0);}
});
test('failed device authentication clears access and never automatically retries the order',async()=>{
 const h=harness({failure:'Authenticated control required'});await h.run("setMode('live')");assert.equal(h.calls.length,1);assert.equal(h.run('tradeControlToken'),null);assert.match(h.alerts[0],/חיבור המכשיר אינו תקף/);await h.run("setMode('live')");assert.equal(h.calls.length,1);assert.equal(h.connections,1);
});
test('already selected mode reloads without requesting credentials',async()=>{const h=harness();await h.run("setMode('demo')");assert.equal(h.connections,0);assert.equal(h.calls.length,0);assert.equal(h.loads,1);});
