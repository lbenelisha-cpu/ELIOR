import {test} from 'node:test';import assert from 'node:assert/strict';
import monitor from '../netlify/functions/ai-monitor.mjs';
test('missing Wyckoff SQL policy blocks decision and provider requests before deployment migration',async()=>{
 const original=global.fetch;let saved;
 process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_SERVICE_ROLE_KEY='test';
 global.fetch=async(url,options={})=>{
  if(String(url).includes('paper_wyckoff_policy'))return Response.json({strategyId:'LEGACY'});
  if(String(url).includes('agent_monitor_status')){saved=JSON.parse(options.body);return Response.json([]);}
  throw Error('Unexpected operation before migration');
 };
 try{await assert.rejects(monitor(),/WYCKOFF_SQL_MIGRATION_REQUIRED/);assert.equal(saved.status,'error');}finally{global.fetch=original;}
});
test('incomplete cycle waits, next cycle completes, duplicate run makes no provider requests',async()=>{
 const RealDate=Date,original=global.fetch;let limited=true,done=false,cycles=0,provider=0,status;
 global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-09-16T14:06:00Z']));}static now(){return +new RealDate('2026-09-16T14:06:00Z');}};
 process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_SERVICE_ROLE_KEY='test';
 global.fetch=async(url,options={})=>{url=String(url);if(url.includes('api.twelvedata')){provider++;throw Error('unexpected provider call');}
 if(url.includes('paper_wyckoff_policy'))return Response.json({strategyId:'WYCKOFF_D1_V1'});
 if(url.includes('paper_portfolio'))return Response.json([{symbol:'SPY',units:0}]);
 if(url.includes('agent_monitor_status')){if(options.method==='POST')status=JSON.parse(options.body);return Response.json([{checks:3}]);}
 if(url.includes('paper_cycle_runs'))return Response.json(done?[{slot:'done'}]:[]);
 if(url.includes('paper_market_reserve')){const key=JSON.parse(options.body).p_key;if(limited&&key.includes('SPY'))return Response.json({state:'limited'});return Response.json({state:'cached',payload:key.startsWith('price:')?{price:3,cached_at:new Date().toISOString()}:{values:Array.from({length:80},(_,i)=>({close:100+i,open:100+i,high:100+i,low:100+i,datetime:new RealDate(Date.UTC(2026,8,15-i)).toISOString().slice(0,10)}))}});}
 if(url.includes('apply_paper_cycle')){cycles++;done=true;return Response.json({symbols:['SPY']});}throw Error(url);};
 try{await monitor();assert.equal(cycles,0);assert.equal(status.status,'waiting');limited=false;await monitor();assert.equal(cycles,1);assert.equal(status.status,'ok');await monitor();assert.equal(cycles,1);assert.equal(provider,0);}finally{global.Date=RealDate;global.fetch=original;}
});
test('cloud held position checks exit using fresh price without requesting history or unrelated assets',async()=>{
 const RealDate=Date,original=global.fetch;let cycles=0;
 global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-09-16T14:06:00Z']));}static now(){return +new RealDate('2026-09-16T14:06:00Z');}};
 process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_SERVICE_ROLE_KEY='test';
 global.fetch=async(url,options={})=>{
  url=String(url);if(url.includes('paper_portfolio'))return Response.json([{symbol:'SPY',units:1}]);
  if(url.includes('paper_wyckoff_policy'))return Response.json({strategyId:'WYCKOFF_D1_V1'});
  if(url.includes('agent_monitor_status'))return Response.json([{checks:1}]);
  if(url.includes('paper_cycle_runs'))return Response.json([]);
  if(url.includes('paper_market_reserve')){const key=JSON.parse(options.body).p_key;assert.ok(key.startsWith('price:'));assert.ok(key.includes('SPY')||key.includes('USD/ILS'));return Response.json({state:'cached',payload:{price:107,cached_at:new Date().toISOString()}});}
  if(url.includes('apply_paper_cycle')){cycles++;const q=JSON.parse(options.body).p_quotes.SPY;assert.equal(q.price,107);assert.equal(q.wyckoff,undefined);return Response.json({symbols:['SPY']});}
  throw Error('Unexpected '+url);
 };
 try{await monitor();assert.equal(cycles,1);}finally{global.Date=RealDate;global.fetch=original;}
});
