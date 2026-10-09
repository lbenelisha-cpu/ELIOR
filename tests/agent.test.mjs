import {test} from 'node:test';
import assert from 'node:assert/strict';
import {score,target,fresh,slot} from '../lib/agent.mjs';
const values=Array.from({length:80},(_,i)=>({close:100-i*.1}));
test('scores valid bars and rejects invalid prices',()=>{
  assert.ok(score(values).master>=60);
  assert.throws(()=>score(values.slice(0,20)));
  assert.throws(()=>score([{close:0},...values]));
  assert.throws(()=>score([{close:'bad'},...values]));
});
test('sell can liquidate and exposure is bounded',()=>{
  assert.equal(target(20),0); assert.equal(target(100),.8); assert.equal(target(60),.65);
});
test('freshness rejects stale and future data',()=>{
  const now=Date.parse('2026-09-16T15:33:00Z');
  assert.equal(fresh('2026-09-16 15:30:00',now),true);
  assert.equal(fresh('2026-09-16 14:30:00',now),false);
  assert.equal(fresh('2026-09-16 16:00:00',now),false);
  assert.equal(fresh('bad',now),false);
  assert.equal(slot(new Date(now)),'2026-09-16T15:30:00.000Z');
});
test('deployed handlers import as ESM',async()=>{
  for(const name of ['cloud-state.js','market-data.js','fx-rate.js','market-scanner.mjs']){
    assert.equal(typeof (await import('../netlify/functions/'+name)).handler,'function');
  }
});
test('scanner reads cached data without provider calls',async()=>{
 process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_SERVICE_ROLE_KEY='test';
 const original=global.fetch;let calls=0;
 global.fetch=async url=>{calls++;assert.ok(String(url).startsWith('https://db.test'));
 const now=Date.now();
 return Response.json([{key:'time_series:'+JSON.stringify([['interval','1day'],['symbol','SPY']]),payload:{values:Array.from({length:5},(_,i)=>({datetime:new Date(now-(6-i)*86400000).toISOString().slice(0,10),open:100,high:102,low:98,close:100}))}},{key:'price:'+JSON.stringify([['symbol','SPY']]),payload:{price:'100',cached_at:new Date(now).toISOString()}}]);};
 try{const r=await (await import('../netlify/functions/market-scanner.mjs')).handler();assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).candidates.length,1);assert.equal(calls,1);}finally{global.fetch=original;}
});
