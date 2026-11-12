import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
function setup(token='device'){
 const nodes=new Map(),calls=[];for(const id of ['colmexBrokerInspect','colmexBrokerConnect','colmexBrokerDisconnect','colmexBrokerConnectionStatus','colmexManualDetails'])nodes.set(id,{disabled:true,textContent:'',addEventListener(k,f){this[k]=f;},scrollIntoView(){}});
 const ctx=vm.createContext({document:{hidden:false,getElementById:id=>nodes.get(id)},localStorage:{getItem:()=>token},Date,Math,AbortSignal,setInterval(){},fetch:async(url,options)=>{calls.push({url,options});const action=options.body&&JSON.parse(options.body).action;return {ok:true,json:async()=>({enabled:action!=='disconnect',readOnly:action==='inspect',settledAt:Date.now()+30000})};}});
 vm.runInContext(fs.readFileSync(new URL('../colmex-connection-ui.js',import.meta.url),'utf8'),ctx);return {nodes,calls};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('page load only reads connection state; explicit disconnect uses device authority and shows monitoring pause',async()=>{
 const u=setup();await settle();assert.equal(u.calls.length,1);assert.equal(u.calls[0].options.method,'GET');assert.equal(u.nodes.get('colmexBrokerDisconnect').disabled,false);
 await u.nodes.get('colmexBrokerDisconnect').click();assert.equal(u.calls[1].options.method,'POST');assert.deepEqual(JSON.parse(u.calls[1].options.body),{action:'disconnect'});assert.equal(u.calls[1].options.headers.Authorization,'Bearer device');assert.match(u.nodes.get('colmexBrokerConnectionStatus').textContent,/אין התחברויות חדשות/);assert.equal(u.nodes.get('colmexBrokerDisconnect').disabled,true);assert.equal(u.nodes.get('colmexBrokerConnect').disabled,false);
});
test('unpaired device cannot change global connection and is directed to existing pairing controls',async()=>{
 const u=setup(null);await settle();await u.nodes.get('colmexBrokerDisconnect').click();assert.equal(u.calls.length,1);assert.equal(u.nodes.get('colmexManualDetails').open,true);assert.match(u.nodes.get('colmexBrokerConnectionStatus').textContent,/לחבר את המכשיר/);
});

test('diagnostic button requests read-only mode and clearly reports trading blocked',async()=>{const u=setup();await settle();await u.nodes.get('colmexBrokerDisconnect').click();await u.nodes.get('colmexBrokerInspect').click();assert.deepEqual(JSON.parse(u.calls.at(-1).options.body),{action:'inspect'});assert.match(u.nodes.get('colmexBrokerConnectionStatus').textContent,/חסומים בשרת/);assert.equal(u.nodes.get('colmexBrokerConnect').disabled,true);});
