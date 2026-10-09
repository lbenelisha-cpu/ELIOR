import test from 'node:test';
import assert from 'node:assert/strict';
import {MT5Client,checkRequest,createBridge} from '../mt5/bridge.mjs';
test('local request checks reject remote hosts and origins',()=>{
 assert.equal(checkRequest({headers:{host:'127.0.0.1:22348'}},22348),true);
 assert.equal(checkRequest({headers:{host:'attacker.example:22348'}},22348),false);
 assert.equal(checkRequest({headers:{host:'127.0.0.1:22348',origin:'https://attacker.example'}},22348),false);
});
test('disconnected account does not expose stale balances or positions',async()=>{
 const client=new MT5Client('test');client.connect=async()=>{};client.call=async name=>{assert.equal(name,'get_trading_account_info');return {account:{type:'real',balance:999},terminal:{server_connected:false}};};
 const data=await client.snapshot();assert.equal(data.connected,false);assert.equal(data.account.balance,null);assert.equal(data.positions,null);
});
test('trading tools cannot pass through the bridge',async()=>{
 await assert.rejects(new MT5Client('test').call('trade_send_market_order'),/Read-only/);
 assert.throws(()=>new MT5Client('test','http://example.com/mcp'),/local/);
});
test('account requests require a session and reject mutations',async t=>{
 const server=createBridge({snapshot:async()=>({connected:true})},22349);await new Promise(r=>server.listen(22349,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const root='http://127.0.0.1:22349';assert.equal((await fetch(root+'/api/account')).status,401);
 const session=await (await fetch(root+'/api/session')).json();assert.equal((await fetch(root+'/api/account',{headers:{'X-ELIOR-Session':session.session}})).status,200);
 assert.equal((await fetch(root+'/api/account',{method:'POST'})).status,405);
 assert.equal((await fetch(root+'/api/session',{headers:{Origin:'https://attacker.example'}})).status,403);
});

test('cross-site page navigation is allowed but account reads are blocked',()=>{
 const headers={host:'127.0.0.1:22348','sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'};
 assert.equal(checkRequest({method:'GET',url:'/mt5',headers},22348),true);
 assert.equal(checkRequest({method:'GET',url:'/api/account',headers},22348),false);
 assert.equal(checkRequest({method:'GET',url:'/api/session',headers},22348),false);
});
