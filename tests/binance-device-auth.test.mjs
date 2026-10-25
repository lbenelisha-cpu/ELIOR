import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {DeviceControlSessions,createDevicePairCode} from '../lib/binance-device-auth.mjs';
const master='master-'.repeat(6);
function setup(){const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'levi-device-')),'sessions.json');let now=1800000000000;const auth=new DeviceControlSessions(file,{authority:master,now:()=>now});return {auth,file,pair:()=>createDevicePairCode(file,{now}),advance:n=>now+=n,now:()=>now};}
test('one short pairing code creates a durable device credential without persisting either secret',()=>{
 const h=setup(),pair=h.pair();assert.match(pair.code,/^\d{6}$/);const result=h.auth.issue(pair.code);assert.match(result.token,/^device-[a-f0-9]{64}$/);
 assert.equal(h.auth.authorized('Bearer '+result.token),true);assert.equal(new DeviceControlSessions(h.file,{authority:master,now:h.now}).authorized('Bearer '+result.token),true);
 const text=fs.readFileSync(h.file,'utf8');assert(!text.includes(result.token));assert(!text.includes(master));assert.equal(fs.statSync(h.file).mode&0o777,0o600);assert.throws(()=>h.auth.issue(pair.code));
});
test('pairing never authorizes a six-digit bearer or accepts a missing or expired secret',()=>{
 const h=setup(),pair=h.pair();assert.equal(h.auth.authorized('Bearer '+pair.code),false);assert.equal(h.auth.authorized(undefined),false);h.advance(15*60000);assert.throws(()=>h.auth.issue(pair.code));
});
test('five wrong attempts persistently lock a pairing code, including across process restart',()=>{
 const h=setup(),pair=h.pair(),wrong=pair.code==='000000'?'111111':'000000';for(let i=0;i<5;i++)assert.throws(()=>h.auth.issue(wrong));
 const restarted=new DeviceControlSessions(h.file,{authority:master,now:h.now});assert.throws(()=>restarted.issue(pair.code),e=>e.status===429);const replacement=h.pair();assert.equal(restarted.issue(replacement.code).ok,true);
});
test('expiry, explicit revocation and changing master configuration deny old device access',()=>{
 const h=setup(),first=h.auth.issue(h.pair().code),second=h.auth.issue(h.pair().code);h.auth.revoke('Bearer '+first.token);assert.equal(h.auth.authorized('Bearer '+first.token),false);assert.equal(h.auth.authorized('Bearer '+second.token),true);
 h.advance(180*86400000);assert.equal(h.auth.authorized('Bearer '+second.token),false);
 const other=setup(),token=other.auth.issue(other.pair().code).token;assert.equal(new DeviceControlSessions(other.file,{authority:'new-'.repeat(10),now:other.now}).authorized('Bearer '+token),false);
});
test('missing master configuration never enables device pairing or trading',()=>{
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'levi-disabled-')),'sessions.json'),auth=new DeviceControlSessions(file,{authority:'short'});assert.equal(auth.enabled,false);assert.equal(auth.authorized('Bearer device-'+'a'.repeat(64)),false);assert.throws(()=>auth.issue('123456'));assert.throws(()=>createDevicePairCode(file));
});
test('a device limit keeps eight recent credentials and does not preserve an evicted device',()=>{
 const h=setup(),tokens=[];for(let i=0;i<9;i++)tokens.push(h.auth.issue(h.pair().code).token);assert.equal(h.auth.authorized('Bearer '+tokens[0]),false);for(const token of tokens.slice(1))assert.equal(h.auth.authorized('Bearer '+token),true);
});
test('public capability and pairing route do not remove authorization from real trading endpoints',()=>{
 const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(source,/const authorized=controlAuthorized\(req.headers.authorization,process.env.BINANCE_CONTROL_TOKEN\)\|\|controlDevices.authorized\(req.headers.authorization\)/);
 assert.match(source,/if\(protectedControl&&!authorized\)/);
 assert.match(source,/u.pathname.startsWith\('\/api\/binance-live\/'\)/);
 const a=source.indexOf("if(u.pathname==='/api/binance-control/session'"),b=source.indexOf("if(u.pathname==='/api/binance-control/disconnect'",a),pair=source.slice(a,b);
 assert.match(pair,/controlDevices.issue\(input.code\)/);assert.doesNotMatch(pair,/placeLiveMarket|liveOrders|executeManualTrade/);
});
test('actual HTTP guard accepts a paired device, rejects anonymous trades and revokes access without executing an order',async()=>{
 const {EventEmitter}=await import('node:events'),{default:vm}=await import('node:vm'),{controlAuthorized}=await import('../lib/binance-control-auth.mjs');
 const h=setup(),source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');let handler;
 const http={createServer:fn=>{handler=fn;return {};}};
 const c=vm.createContext({http,URL,mode:'live',controlAuthorized,controlDevices:h.auth,process:{env:{BINANCE_CONTROL_TOKEN:master}},send:(res,body,status=200)=>{res.result={body,status};}});
 const a=source.indexOf('const server=http.createServer('),b=source.indexOf('  const sf={',a);vm.runInContext(source.slice(a,b)+'return send(res,{acceptedByGuard:true});});',c);
 const request=(url,body={},token=null)=>{const req=new EventEmitter();Object.assign(req,{url,method:'POST',headers:{host:'localhost',...(token?{authorization:'Bearer '+token}:{})},destroy(){}});const res={};handler(req,res);req.emit('data',JSON.stringify(body));req.emit('end');return res.result;};
 assert.equal(request('/api/binance-live/manual').status,401);
 const pair=request('/api/binance-control/session',{code:h.pair().code});assert.equal(pair.status,200);const token=pair.body.token;
 assert.equal(request('/api/binance-live/manual',{},token).body.acceptedByGuard,true);
 assert.equal(request('/api/binance-control/disconnect',{},token).status,200);
 assert.equal(request('/api/binance-live/manual',{},token).status,401);
 assert.equal(request('/api/binance-mode',{},master).body.acceptedByGuard,true);
});
test('owner configured fixed code survives repeated connections and restart, is hashed, and has one-year sessions',()=>{
 const h=setup(),p=createDevicePairCode(h.file,{now:h.now(),reusable:true,code:'123456'});assert.equal(p.expiresAt,null);
 const tokens=Array.from({length:12},()=>h.auth.issue('123456').token);for(const token of tokens)assert.equal(h.auth.authorized('Bearer '+token),true);
 const restarted=new DeviceControlSessions(h.file,{authority:master,now:h.now});assert.equal(restarted.issue('123456').ok,true);assert(!fs.readFileSync(h.file+'.pair','utf8').includes('123456'));
 h.advance(181*86400000);assert.equal(restarted.authorized('Bearer '+tokens[0]),true);h.advance(185*86400000);assert.equal(restarted.authorized('Bearer '+tokens[0]),false);
});
test('fixed code wrong attempts cool down and recover without replacing the code; revocation remains per device',()=>{
 const h=setup();createDevicePairCode(h.file,{now:h.now(),reusable:true,code:'654321'});const a=h.auth.issue('654321'),b=h.auth.issue('654321');
 for(let i=0;i<5;i++)assert.throws(()=>h.auth.issue('000000'));assert.throws(()=>h.auth.issue('654321'),e=>e.status===429);
 h.advance(15*60000);assert.equal(h.auth.issue('654321').ok,true);h.auth.revoke('Bearer '+a.token);assert.equal(h.auth.authorized('Bearer '+a.token),false);assert.equal(h.auth.authorized('Bearer '+b.token),true);
 assert.equal(h.auth.authorized('Bearer 654321'),false);
});
test('fixed code CLI accepts owner input without echoing its plaintext into command output',async()=>{
 const {spawnSync}=await import('node:child_process');const h=setup(),code='093782';const out=spawnSync(process.execPath,['scripts/binance-device-pair.mjs','--permanent','--code-stdin'],{cwd:new URL('..',import.meta.url),env:{...process.env,BINANCE_DEVICE_AUTH_FILE:h.file},input:code,encoding:'utf8'});
 assert.equal(out.status,0,out.stderr);assert.equal(out.stdout.includes(code),false);assert.equal(h.auth.issue(code).ok,true);
});
