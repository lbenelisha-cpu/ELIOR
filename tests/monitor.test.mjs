import {test} from 'node:test';import assert from 'node:assert/strict';
import monitor from '../netlify/functions/ai-monitor.mjs';
test('incomplete cycle waits, next cycle completes, duplicate run makes no provider requests',async()=>{
 const RealDate=Date,original=global.fetch;let limited=true,done=false,cycles=0,provider=0,status;
 global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-09-16T14:06:00Z']));}static now(){return +new RealDate('2026-09-16T14:06:00Z');}};
 process.env.SUPABASE_URL='https://db.test';process.env.SUPABASE_SERVICE_ROLE_KEY='test';
 global.fetch=async(url,options={})=>{url=String(url);if(url.includes('api.twelvedata')){provider++;throw Error('unexpected provider call');}
 if(url.includes('paper_portfolio'))return Response.json([{symbol:'SPY'}]);
 if(url.includes('agent_monitor_status')){if(options.method==='POST')status=JSON.parse(options.body);return Response.json([{checks:3}]);}
 if(url.includes('paper_cycle_runs'))return Response.json(done?[{slot:'done'}]:[]);
 if(url.includes('paper_market_reserve')){const key=JSON.parse(options.body).p_key;if(limited&&key.includes('AMZN'))return Response.json({state:'limited'});return Response.json({state:'cached',payload:key.startsWith('price:')?{price:3}:{values:Array.from({length:80},(_,i)=>({close:100+i,datetime:'2026-09-16 14:00:00'}))}});}
 if(url.includes('apply_paper_cycle')){cycles++;done=true;return Response.json({symbols:['SPY']});}throw Error(url);};
 try{await monitor();assert.equal(cycles,0);assert.equal(status.status,'waiting');limited=false;await monitor();assert.equal(cycles,1);assert.equal(status.status,'ok');await monitor();assert.equal(cycles,1);assert.equal(provider,0);}finally{global.Date=RealDate;global.fetch=original;}
});
