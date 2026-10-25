import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDevicePairCode} from '../lib/binance-device-auth.mjs';
import {createReadProxy} from '../netlify/functions/binance-read-proxy.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),token='test-authority-'.padEnd(40,'x');
async function serverRig(t,{journal='[]',pushReadToken}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'binance-http-'));
 const source=fs.readFileSync(path.join(root,'server.mjs'),'utf8'),env={...process.env};
 for(const key of Object.keys(env))if(key.startsWith('BINANCE_')||key==='AUTO_EXECUTION')delete env[key];
 for(const [,key] of source.matchAll(/process\.env\.(BINANCE_[A-Z0-9_]+_FILE)/g))env[key]=path.join(dir,key+'.json');
 Object.assign(env,{PORT:'0',BINANCE_CONTROL_TOKEN:token,BINANCE_MODE:'live',BINANCE_LIVE_TRADING_ENABLED:'false',AUTO_EXECUTION:'false',BINANCE_API_KEY:'test-unused',BINANCE_API_SECRET:'test-unused',BINANCE_DEMO_TRADING_ENABLED:'false'});
 if(pushReadToken!==undefined)env.BINANCE_PUSH_READ_TOKEN=pushReadToken;
 fs.writeFileSync(env.BINANCE_LIVE_LOG_FILE,journal);
 const child=spawn(process.execPath,['--import',path.join(root,'tests/helpers/no-network.mjs'),path.join(root,'server.mjs')],{cwd:root,env,stdio:['ignore','pipe','pipe']});
 let logs='';child.stderr.on('data',d=>{logs=(logs+d).slice(-4000)});
 t.after(async()=>{child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,1500))]);fs.rmSync(dir,{recursive:true,force:true});});
 const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timeout: '+logs)),8000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code+': '+logs));});child.stdout.on('data',data=>{const m=String(data).match(/Server (\d+)/);if(m){clearTimeout(timer);resolve(Number(m[1]));}});});
 const base='http://127.0.0.1:'+port;
 return {base,env,read:(url,auth=token)=>fetch(base+url,{headers:auth?{Authorization:'Bearer '+auth}:{}}),post:(url,body,auth=token)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},body:JSON.stringify(body)})};
}
test('real HTTP server protects private reads and maintenance, supports device sessions through read proxy, and exposes no account on health',async t=>{
 const r=await serverRig(t);
 const health=await(await r.read('/health',null)).json();assert.deepEqual(health,{ok:true,service:'levi-binance'});
 const bootstrap=await(await r.read('/api/binance-mode',null)).json();assert.equal(bootstrap.liveState,null);assert.equal(bootstrap.tradeControl,null);
 for(const endpoint of ['/api/binance-agent','/api/binance-live-account','/api/binance-action-log','/api/binance-chart','/api/binance-kelly','/api/binance-decision-history','/api/binance-demo-account','/api/binance-readiness','/api/binance-settings']){
  assert.equal((await r.read(endpoint,null)).status,401,endpoint);
  assert.equal((await r.read(endpoint,'wrong-token')).status,401,endpoint);
 }
 assert.equal((await r.post('/api/binance-universe/refresh',{},null)).status,401);
 assert.equal((await r.post('/api/binance-trade-control',{action:'stop'},null)).status,401);
 assert.equal((await r.read('/api/binance-agent')).status,200);
 createDevicePairCode(r.env.BINANCE_DEVICE_AUTH_FILE,{code:'001234',reusable:true});
 const session=await(await r.post('/api/binance-control/session',{code:'001234'},null)).json();assert.match(session.token,/^device-/);
 const proxy=createReadProxy((url,options)=>{assert.equal(url.origin,'https://levi-binance.2-29-48-20.sslip.io');assert.equal(options.headers.Cookie,undefined);return fetch(r.base+url.pathname+url.search,options);});
 const proxied=await proxy({httpMethod:'GET',queryStringParameters:{path:'/api/binance-action-log'},headers:{authorization:'Bearer '+session.token,cookie:'must-not-forward'}});
 assert.equal(proxied.statusCode,200);
 assert.equal((await r.post('/api/binance-control/disconnect',{},session.token)).status,200);
 assert.equal((await r.read('/api/binance-action-log',session.token)).status,401);
});
test('corrupt live journal keeps server observable but trading readiness closed and original file untouched',async t=>{
 const r=await serverRig(t,{journal:'{broken'});
 const state=await(await r.read('/api/binance-readiness')).json();assert.equal(state.liveState.ready,false);assert.equal(state.liveState.journalReady,false);
 assert.equal(fs.readFileSync(r.env.BINANCE_LIVE_LOG_FILE,'utf8'),'{broken');
 assert.equal((await r.post('/api/binance-trade-control',{action:'resume'})).status,500);
});
test('scheduled notification credential permits only the two GET feeds and never grants control or account access',async t=>{
 const pushReadToken='notification-only-'.padEnd(64,'p'),r=await serverRig(t,{pushReadToken});
 for(const endpoint of ['/api/binance-action-log','/api/binance-agent']){
  assert.equal((await r.read(endpoint,pushReadToken)).status,200);
  assert.equal((await r.read(endpoint,'wrong-token')).status,401);
  assert.equal((await r.read(endpoint,null)).status,401);
 }
 for(const endpoint of ['/api/binance-live-account','/api/binance-settings','/api/binance-readiness','/api/binance-control/disconnect'])assert.equal((await r.read(endpoint,pushReadToken)).status,401);
 for(const endpoint of ['/api/binance-live/manual','/api/binance-trade-control','/api/binance-settings','/api/binance-mode','/api/binance-agent/evaluate','/api/binance-control/disconnect'])assert.equal((await r.post(endpoint,{},pushReadToken)).status,401);
 const unconfigured=await serverRig(t);
 assert.equal((await unconfigured.read('/api/binance-action-log',pushReadToken)).status,401);
});
test('pause-only persists without liquidation; demo viewing retains the real managed ledger',async t=>{
 const buy={type:'BUY',symbol:'BTCUSDT',qty:1,price:100,at:'2026-10-25T18:00:00Z',wyckoffTrade:{strategyId:'WYCKOFF_5M_V1',peakPrice:100}};
 const journal=JSON.stringify([buy]),r=await serverRig(t,{journal});
 assert.equal((await r.post('/api/binance-trade-control',{action:'pause'})).status,200);
 assert.equal(fs.readFileSync(r.env.BINANCE_LIVE_LOG_FILE,'utf8'),journal);
 assert.equal(JSON.parse(fs.readFileSync(r.env.BINANCE_TRADE_CONTROL_FILE)).paused,true);
 assert.equal((await r.post('/api/binance-mode',{mode:'demo'})).status,200);
 const state=await(await r.read('/api/binance-readiness')).json();assert.equal(state.liveState.managedPositions,1);assert.deepEqual(state.liveState.missingProtection,['BTCUSDT']);
});
