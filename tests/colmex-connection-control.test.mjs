import test from 'node:test';import assert from 'node:assert/strict';
import {ColmexConnectionControl} from '../lib/colmex-connection-control.mjs';
import {ColmexSessionStore} from '../lib/colmex-session-store.mjs';
import {ColmexClient} from '../lib/colmex-client-api.mjs';
import {AutoBroker} from '../lib/colmex-auto-broker.mjs';
import {makeConnectionHandler} from '../netlify/functions/colmex-connection.mjs';
import {pairDevice} from '../lib/colmex-device-access.mjs';
function memory(){const rows=new Map();let seq=0;return {get:async k=>rows.get(k)?.data||null,getWithMetadata:async k=>structuredClone(rows.get(k)||null),setJSON:async(k,data,o={})=>{const old=rows.get(k);if(o.onlyIfNew&&old||o.onlyIfMatch&&o.onlyIfMatch!==old?.etag)return {modified:false};const r={data:structuredClone(data),etag:String(++seq)};rows.set(k,r);return {modified:true,etag:r.etag};}};}
const env={CONTEXT:'production',COLMEX_API_LOGIN:'fixture',COLMEX_API_PASSWORD:'fixture-pass',COLMEX_AUTO_ACCOUNT_ID:'123',COLMEX_DEVICE_PAIR_CODE:'123456'};
function setup(){const store=memory(),control=new ColmexConnectionControl({login:'fixture',password:'fixture-pass',store});return {store,control,session:new ColmexSessionStore({login:'fixture',password:'fixture-pass',store,control})};}
test('pause persists across instances; unavailable control storage never assumes enabled',async()=>{
 const {control,store}=setup();assert.equal((await control.read()).enabled,true);const off=await control.setEnabled(false);assert.equal(off.enabled,false);assert.equal(off.settledAt-off.updatedAt,30000);
 const another=new ColmexConnectionControl({login:'fixture',password:'fixture-pass',store});await assert.rejects(another.assertEnabled(),{code:'CONNECTION_PAUSED'});assert.deepEqual(await control.setEnabled(false),off);
 await assert.rejects(new ColmexConnectionControl({store:{getWithMetadata(){throw Error('storage');}}}).read(),{code:'CONNECTION_STATE_UNAVAILABLE'});
});
test('paused readers and warm cached tokens cannot call broker; reconnect uses a fresh session',async()=>{
 const {control,session}=setup();let auth=0,reads=0;
 const c=new ColmexClient({login:'fixture',password:'fixture-pass',sessionStore:session,fetchImpl:async url=>{if(url.endsWith('/authorize')){auth++;return new Response(JSON.stringify({s:'ok',d:{access_token:'fixture-'+auth,expiration:Date.now()/1000+3600}}));}reads++;return new Response(JSON.stringify({s:'ok',d:{accounts:[]}}));}});
 await c.get('/accounts');assert.equal(auth,1);assert.equal(reads,1);
 await control.setEnabled(false);await assert.rejects(c.get('/accounts'),{code:'CONNECTION_PAUSED'});assert.equal(auth,1);assert.equal(reads,1);
 await control.setEnabled(true);await c.get('/accounts');assert.equal(auth,2);assert.equal(reads,2);
});
test('disconnect during authorization discards the response and cannot issue a follow-up read',async()=>{
 const {control,session}=setup();let reads=0;
 const c=new ColmexClient({sessionStore:session,fetchImpl:async url=>{if(url.endsWith('/authorize')){await control.setEnabled(false);return new Response(JSON.stringify({s:'ok',d:{access_token:'late',expiration:Date.now()/1000+3600}}));}reads++;throw Error('must not read');}});
 await assert.rejects(c.get('/accounts'));assert.equal(reads,0);await assert.rejects(session.acquire(()=>{throw Error('must not authenticate');}),{code:'CONNECTION_PAUSED'});
});
test('pause prevents financial mutation with an explicit NOT_SENT outcome',async()=>{
 const {control,session}=setup();await control.setEnabled(false);let writes=0;
 const b=new AutoBroker({env,sessionStore:session,deadline:Date.now()+20000,fetchImpl:async()=>{writes++;throw Error('must not call broker');}});
 await assert.rejects(b.write('123',{kind:'BUY',id:'example',order:{}}),e=>e.outcome==='NOT_SENT');assert.equal(writes,0);
});
test('connection endpoint GET is read-only; writes require a paired device, same origin and exact action',async()=>{
 const {control}=setup(),devices=memory();const h=makeConnectionHandler({env,deviceStoreFactory:()=>devices,controlFactory:()=>control});
 const url='https://example.test/.netlify/functions/colmex-connection';
 assert.equal((await h(new Request(url),{deploy:{context:'production'}})).status,200);
 const send=(body,token,origin='https://example.test')=>h(new Request(url,{method:'POST',headers:{origin,'Content-Type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)}),{deploy:{context:'production'}});
 assert.equal((await send({action:'disconnect'})).status,401);assert.equal((await control.read()).enabled,true);
 const {token}=await pairDevice(devices,env,'123456');assert.equal((await send({action:'disconnect'},token,'https://evil.test')).status,403);
 assert.equal((await send({action:'disconnect',account:'other'},token)).status,400);
 const off=await (await send({action:'disconnect'},token)).json();assert.equal(off.enabled,false);assert.equal(off.brokerLogout,false);assert.equal(off.revision,undefined);
 assert.equal((await (await send({action:'connect'},token)).json()).enabled,true);
});
test('diagnostic connection permits reads but rejects every financial write before authentication',async()=>{
 const {control,session}=setup();await control.setEnabled(true,{readOnly:true});let calls=0;
 const fetchImpl=async()=>{calls++;return new Response(JSON.stringify({s:'ok',d:{access_token:'read-token',expiration:Date.now()/1000+3600,accounts:[]}}));};
 const c=new ColmexClient({sessionStore:session,fetchImpl});await c.get('/accounts');assert.equal(calls,2);
 const b=new AutoBroker({env,sessionStore:session,deadline:Date.now()+20000,fetchImpl});
 for(const kind of ['BUY','STOP','PROTECTION','CLOSE'])await assert.rejects(b.write('123',{kind,id:'example',order:{},positionId:'1'}),e=>e.outcome==='NOT_SENT'&&e.code==='WRITE_READ_ONLY');
 assert.equal(calls,2);await assert.rejects(control.assertTradingEnabled(),{code:'CONNECTION_READ_ONLY'});
});
test('switch to diagnostic during authentication blocks mutation at final dispatch guard',async()=>{
 const {control,session}=setup();let writes=0;
 const b=new AutoBroker({env,sessionStore:session,deadline:Date.now()+20000,fetchImpl:async url=>{if(url.endsWith('/authorize')){await control.setEnabled(true,{readOnly:true});return new Response(JSON.stringify({s:'ok',d:{access_token:'late',expiration:Date.now()/1000+3600}}));}writes++;throw Error('not allowed');}});
 await assert.rejects(b.write('123',{kind:'BUY',id:'example',order:{}}),e=>e.outcome==='NOT_SENT');assert.equal(writes,0);
});
test('paired diagnostic action persists read-only mode; GET cannot switch it to trading',async()=>{
 const {control}=setup(),devices=memory();await control.setEnabled(false);const {token}=await pairDevice(devices,env,'123456');
 const h=makeConnectionHandler({env,deviceStoreFactory:()=>devices,controlFactory:()=>control}),url='https://example.test/.netlify/functions/colmex-connection';
 const r=await h(new Request(url,{method:'POST',headers:{'Content-Type':'application/json',origin:'https://example.test',authorization:'Bearer '+token},body:JSON.stringify({action:'inspect'})}),{deploy:{context:'production'}});assert.equal(r.status,200);assert.equal((await r.json()).readOnly,true);
 const d=await (await h(new Request(url),{deploy:{context:'production'}})).json();assert.equal(d.enabled,true);assert.equal(d.readOnly,true);await assert.rejects(control.assertTradingEnabled(),{code:'CONNECTION_READ_ONLY'});
});
