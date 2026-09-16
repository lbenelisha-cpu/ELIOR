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
test('scanner preserves partial candidates when provider or database fails',async()=>{
  process.env.TWELVE_DATA_API_KEY='test';
  const original=global.fetch;
  global.fetch=async url=>{
    const symbol=new URL(url).searchParams.get('symbol');
    if(symbol==='AAPL')return Response.json({status:'error',message:'API credits exhausted'},{status:429});
    return Response.json({values:values.map(v=>({...v,datetime:new Date().toISOString().slice(0,19).replace('T',' ')}))});
  };
  try{
    const {handler}=await import('../netlify/functions/market-scanner.mjs');
    const r=await handler(),body=JSON.parse(r.body);
    assert.equal(r.statusCode,200);assert.equal(body.candidates.length,7);
    assert.equal(body.leader.verified,false);assert.match(body.warnings[0],/AAPL/);
  }finally{global.fetch=original;}
});
