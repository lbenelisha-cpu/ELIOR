import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness({token='a'.repeat(40),mode='demo',failure=null,confirm=true}={}){
  const source=fs.readFileSync(new URL('../binance-agent.js',import.meta.url),'utf8');
  const calls=[],alerts=[];let prompts=0,loads=0;
  const context=vm.createContext({MODE:'/mode',TRADE_CONTROL:'/control',tradeControlToken:null,
    prompt:()=>{prompts++;return token;},confirm:()=>confirm,alert:x=>alerts.push(x),
    load:async()=>{loads++;},J:async(url,options)=>{
      if(!options)return {mode};
      calls.push({url,...options});if(failure)throw Error(failure);return {ok:true};
    }});
  vm.runInContext(source.slice(source.indexOf('async function authenticatedControl('),source.indexOf('async function sendTradeControl(')),context);
  return {context,calls,alerts,get prompts(){return prompts;},get loads(){return loads;},run:code=>vm.runInContext(code,context)};
}
test('both mode transitions send the control bearer token and reuse it for controls',async()=>{
  for(const [mode,target] of [['demo','live'],['live','demo']]){
    const h=harness({mode});await h.run(`setMode('${target}')`);
    assert.equal(h.calls[0].headers.Authorization,'Bearer '+'a'.repeat(40));
    assert.equal(JSON.parse(h.calls[0].body).mode,target);assert.equal(h.loads,1);
    await h.run("authenticatedControl(TRADE_CONTROL,{action:'start'})");
    assert.equal(h.prompts,1);assert.equal(h.calls[1].headers.Authorization,h.calls[0].headers.Authorization);
  }
});
test('cancelled, short or unconfirmed credentials never send a mode mutation',async()=>{
  for(const options of [{token:null},{token:'short'},{confirm:false}]){
    const h=harness(options);await h.run("setMode('live')");
    assert.equal(h.calls.length,0);assert.equal(h.loads,0);
  }
});
test('failed authentication clears the token and asks again without automatic retry',async()=>{
  const h=harness({failure:'Authenticated control required'});
  await h.run("setMode('live')");assert.equal(h.calls.length,1);assert.equal(h.loads,0);
  assert.equal(h.run('tradeControlToken'),null);assert.match(h.alerts[0],/האימות נכשל/);
  await h.run("setMode('live')");assert.equal(h.prompts,2);
});
test('already selected mode reloads without requesting credentials',async()=>{
  const h=harness();await h.run("setMode('demo')");assert.equal(h.prompts,0);assert.equal(h.calls.length,0);assert.equal(h.loads,1);
});
