import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
function setup({connected=true,storageFails=false}={}){
 const nodes=new Map(),saved=new Map(),calls=[];if(connected)saved.set('levi-colmex-device-v1','colmex-device-'+ 'a'.repeat(64));
 const element=()=>({textContent:'',value:'',disabled:false,hidden:false,showModal(){this.open=true;},close(){this.open=false;},addEventListener(event,cb){this[event]=cb;}});
 const document={hidden:false,addEventListener(){},getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);}};
 document.getElementById('selectedSymbol').textContent='AAPL';document.getElementById('colmexTradeAmount').value='50';
 let response={ok:true,status:202,json:async()=>({ok:true,status:'PENDING'})};
 const context=vm.createContext({document,localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>{if(storageFails)throw Error('storage');saved.set(k,v);},removeItem:k=>saved.delete(k)},fetch:async(url,options)=>{calls.push({url,options});return response;},AbortSignal,crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},setInterval(){}});
 vm.runInContext(fs.readFileSync(new URL('../colmex-manual-ui.js',import.meta.url),'utf8'),context);
 return {nodes,saved,calls,setResponse:r=>{response=r;}};
}
test('opening buy/sell dialogs never trades; chosen amount and fixed symbol submit without password',async()=>{
 const u=setup();u.nodes.get('colmexManualBuy').click();assert.equal(u.calls.length,0);assert.equal(u.nodes.get('colmexTradeSymbol').value,'AAPL');
 await u.nodes.get('colmexTradeForm').submit({preventDefault(){}});assert.equal(u.calls.length,1);const sent=JSON.parse(u.calls[0].options.body);assert.equal(sent.amountUsd,50);assert.equal(sent.side,'BUY');assert.equal(sent.symbol,'AAPL');assert.match(u.calls[0].options.headers.Authorization,/^Bearer colmex-device-/);assert.equal(u.nodes.get('colmexManualBuy').disabled,true);
 await u.nodes.get('colmexTradeForm').submit({preventDefault(){}});assert.equal(u.calls.length,1);
});
test('no connection disables trade controls, and pending-ID persistence failure sends nothing',async()=>{
 assert.equal(setup({connected:false}).nodes.get('colmexManualSell').disabled,true);
 const u=setup({storageFails:true});u.nodes.get('colmexManualBuy').click();await u.nodes.get('colmexTradeForm').submit({preventDefault(){}});assert.equal(u.calls.length,0);
});
test('unknown result remains pending across refresh; only terminal broker status unlocks buttons',async()=>{
 const u=setup();u.setResponse({ok:false,status:503,json:async()=>({error:'TRADE_RESULT_UNCERTAIN'})});u.nodes.get('colmexManualBuy').click();await u.nodes.get('colmexTradeForm').submit({preventDefault(){}});
 assert.ok(u.saved.has('levi-colmex-manual-pending-v1'));assert.equal(u.nodes.get('colmexManualBuy').disabled,true);
 u.setResponse({ok:true,status:200,json:async()=>({status:'FILLED',symbol:'AAPL'})});await u.nodes.get('colmexCheckTrade').click();assert.equal(u.saved.has('levi-colmex-manual-pending-v1'),false);assert.equal(u.nodes.get('colmexManualBuy').disabled,false);assert.equal(u.calls[1].options.method,'GET');
});
test('expired device authorization reopens one-time pairing instead of trapping the user',async()=>{
 const u=setup();u.setResponse({ok:false,status:401,json:async()=>({error:'DEVICE_REQUIRED'})});u.nodes.get('colmexManualBuy').click();await u.nodes.get('colmexTradeForm').submit({preventDefault(){}});
 assert.equal(u.saved.has('levi-colmex-device-v1'),false);assert.equal(u.nodes.get('colmexPairForm').hidden,false);assert.equal(u.nodes.get('colmexManualBuy').disabled,true);
});
test('explicit rejection and proven not-sent outcomes release local pending without a retry',async()=>{
 for(const status of ['REJECTED','NOT_SENT']){
  const u=setup();u.setResponse({ok:true,status:202,json:async()=>({status,symbol:'AAPL'})});u.nodes.get('colmexManualBuy').click();await u.nodes.get('colmexTradeForm').submit({preventDefault(){}});
  assert.equal(u.saved.has('levi-colmex-manual-pending-v1'),false);assert.equal(u.nodes.get('colmexManualBuy').disabled,false);assert.equal(u.calls.length,1);assert.doesNotMatch(u.nodes.get('colmexManualStatus').textContent,/ממתין לאימות/);
 }
});
