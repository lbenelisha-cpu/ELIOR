import test from 'node:test';
import assert from 'node:assert/strict';
import {ColmexClient,mapRow,refreshInterval} from '../lib/colmex-client-api.mjs';
import {makeHandler} from '../netlify/functions/colmex-account.mjs';
const now=Date.parse('2026-10-20T14:00:00Z'),secret='private-view-credential-1234567890';
const config={accountDetailsConfig:{columns:[{id:'openNetPnL'},{id:'balance'},{id:'cashBalance'},{id:'availableFunds'}]},positionsConfig:{columns:[{id:'qty'},{id:'instrumentName'},{id:'unrealizedPl'},{id:'avgPrice'},{id:'side'}]}};
const ok=d=>new Response(JSON.stringify({s:'ok',d}),{status:200});
function rig({respond,accounts=[{id:'42',name:'Demo',type:'demo',currency:'USD'}]}={}){
 const calls=[];let clock=now;
 const fetchImpl=async(url,options)=>{
  const path=new URL(url).pathname.replace('/traderevolution/v1','');calls.push({path,options});const special=await respond?.(path,options,calls);if(special)return special;
  if(path==='/authorize')return ok({access_token:'test-broker-token',expiration:now/1000+3600});
  if(path==='/config')return ok(config);
  if(path==='/accounts')return ok({accounts});
  if(path.endsWith('/state'))return ok({accountDetailsData:[12,1000,200,null]});
  if(path.endsWith('/positions'))return ok({positions:[['2','QQQ','12','500','buy']]});
  throw Error('unexpected URL');
 };
 return {calls,client:new ColmexClient({login:'owner',password:'  p&+secret= ',now:()=>clock,fetchImpl}),tick:ms=>clock+=ms};
}
test('broker credentials form and nested token are server-only, config IDs determine financial meaning',async()=>{
 const r=rig(),d=await r.client.snapshot();assert.equal(d.state.balance,1000);assert.equal(d.state.openNetPnL,12);assert.equal(d.state.availableFunds,null);assert.equal(d.positions[0].instrumentName,'QQQ');assert.equal(d.positions[0].qty,'2');
 assert.deepEqual(r.calls.map(x=>x.path),['/authorize','/config','/accounts','/accounts/42/state','/accounts/42/positions']);
 const auth=r.calls[0];assert.equal(auth.options.method,'POST');assert.equal(auth.options.redirect,'error');const form=new URLSearchParams(auth.options.body);assert.equal(form.get('password'),'  p&+secret= ');assert.equal(form.get('login'),'owner');assert.equal(form.has('client_secret'),false);
 for(const c of r.calls.slice(1)){assert.equal(c.options.method,'GET');assert.equal(c.options.headers.Authorization,'Bearer test-broker-token');}
 assert.equal(JSON.stringify(d).includes('test-broker-token'),false);assert.equal(JSON.stringify(d).includes('p&+secret'),false);
});
test('wrong credentials and upstream text never escape as private provider payload',async()=>{
 const r=rig({respond:p=>p==='/authorize'?new Response('super-secret',{status:403}):null});await assert.rejects(r.client.snapshot(),{code:'AUTH_DENIED'});await assert.rejects(r.client.snapshot(),{code:'AUTH_DENIED'});assert.equal(r.calls.length,1);
});
test('missing, quoted, padded and expired broker access tokens fail closed',async()=>{
 for(const token of ['', '"quoted"',' padded','with space']){const r=rig({respond:p=>p==='/authorize'?ok({access_token:token,expiration:now/1000+100}):null});await assert.rejects(r.client.snapshot(),{code:'AUTH_RESPONSE'});assert.equal(r.calls.length,1);}
 const r=rig({respond:p=>p==='/authorize'?ok({access_token:'old',expiration:now/1000-1}):null});await assert.rejects(r.client.snapshot(),{code:'AUTH_RESPONSE'});
});
test('concurrent same-account reads are single-flight, cached only within refresh window',async()=>{
 const r=rig();const [a,b]=await Promise.all([r.client.snapshot(),r.client.snapshot()]);assert.deepEqual(a,b);assert.equal(r.calls.length,5);r.tick(20000);await r.client.snapshot('42');assert.equal(r.calls.length,5);r.tick(10001);await r.client.snapshot('42');assert.equal(r.calls.length,7);
});
test('401 renews token and remaps using config from the new authentication session',async()=>{
 let failed=false,auths=0;const r=rig({respond:(p)=>{
  if(p==='/authorize'){auths++;return ok({access_token:'session-'+auths,expiration:now/1000+3600});}
  if(p.endsWith('/state')&&!failed){failed=true;return new Response('',{status:401});}
  if(p==='/config'&&auths===2)return ok({...config,accountDetailsConfig:{columns:[{id:'balance'},{id:'openNetPnL'},{id:'cashBalance'},{id:'availableFunds'}]}});
 }});const d=await r.client.snapshot();assert.equal(auths,2);assert.equal(d.state.balance,12);assert.equal(d.state.openNetPnL,1000);assert.equal(r.calls.filter(x=>x.path==='/config').length,2);
});
test('malformed rows, duplicate column IDs and prototype keys cannot display misleading balances',()=>{
 assert.throws(()=>mapRow(config.accountDetailsConfig,[1]),{code:'ROW_SCHEMA'});
 assert.throws(()=>mapRow({columns:[{id:'x'},{id:'x'}]},[1,2]),{code:'COLUMN_SCHEMA'});
 assert.throws(()=>mapRow({columns:[{id:'__proto__'}]},[1]),{code:'COLUMN_SCHEMA'});
 assert.equal(mapRow({columns:[{id:'a'}]},[null]).a,null);
});
test('multiple accounts require selection; foreign IDs and arbitrary endpoint paths never get upstream',async()=>{
 const r=rig({accounts:[{id:'42',name:'a'},{id:'43',name:'b'}]});const d=await r.client.snapshot();assert.equal(d.selectedAccount,null);assert.equal(d.selectionRequired,true);assert.equal(r.calls.length,3);
 await assert.rejects(r.client.snapshot('../withdrawals'),{code:'UNKNOWN_ACCOUNT'});assert.equal(r.calls.length,3);
 await assert.rejects(r.client.json('/withdrawals',{method:'POST'}),{code:'READ_ONLY'});await assert.rejects(r.client.json('/accounts/42/positions',{method:'DELETE'}),{code:'READ_ONLY'});assert.equal(r.calls.length,3);
 const one=await r.client.snapshot('43');assert.equal(one.selectedAccount.id,'43');assert.equal(r.calls.at(-1).path,'/accounts/43/positions');
});
test('declared rate limits extend frontend and server refresh intervals',()=>{assert.equal(refreshInterval({rateLimits:[{rateLimitType:'GET_POSITIONS',measure:'MINUTE',intervalNum:2,limit:1}]}),121000);});
test('public readiness performs no broker authentication, anonymous private reads and every mutation are blocked',async()=>{
 let made=0,calls=0;const env={COLMEX_API_LOGIN:'owner',COLMEX_API_PASSWORD:'never-return',COLMEX_API_READ_TOKEN:secret};const h=makeHandler({env:()=>env,clientFactory:()=>{made++;return {snapshot:async()=>{calls++;return {connected:true,readOnly:true};}};}});
 const status=await h({httpMethod:'GET',queryStringParameters:{action:'status'}});assert.equal(status.statusCode,200);assert.equal(JSON.parse(status.body).credentialsConfigured,true);assert.equal(made,0);assert(!status.body.includes('never-return'));
 assert.equal((await h({httpMethod:'GET'})).statusCode,401);assert.equal((await h({httpMethod:'GET',headers:{Authorization:'bearer '+secret}})).statusCode,401);
 for(const method of ['POST','DELETE','PATCH','PUT'])assert.equal((await h({httpMethod:method,headers:{Authorization:'Bearer '+secret}})).statusCode,405);
 assert.equal(calls,0);const good={httpMethod:'GET',headers:{Authorization:'Bearer '+secret}};assert.equal((await h(good)).statusCode,200);assert.equal(calls,1);
 assert.equal((await h({...good,queryStringParameters:{path:'/withdrawals'}})).statusCode,400);
 assert.equal((await h({...good,headers:{Authorization:'Bearer '+secret+' '}})).statusCode,401);
 env.COLMEX_API_PASSWORD='rotated';await h(good);assert.equal(made,2);
});
test('private route sanitizes all unknown errors; missing credentials and viewer setup never open access',async()=>{
 const h=makeHandler({env:()=>({COLMEX_API_LOGIN:'a',COLMEX_API_PASSWORD:'b',COLMEX_API_READ_TOKEN:secret}),clientFactory:()=>({snapshot:async()=>{throw Error('password and token must not escape');}})});
 const d=await h({httpMethod:'GET',headers:{Authorization:'Bearer '+secret}});assert.equal(d.statusCode,503);assert(!d.body.includes('must not escape'));assert.equal(JSON.parse(d.body).code,'SERVICE_UNAVAILABLE');
 const empty=makeHandler({env:()=>({})});assert.equal((await empty({httpMethod:'GET'})).statusCode,401);assert.equal(JSON.parse((await empty({httpMethod:'GET',queryStringParameters:{action:'status'}})).body).credentialsConfigured,false);
});
