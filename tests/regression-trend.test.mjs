import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const context=vm.createContext({});vm.runInContext(fs.readFileSync(new URL('../regression-trend.js',import.meta.url),'utf8'),context);
const {analyze,levels,describe,draw}=context.LEVI_REGRESSION;
const start=Date.parse('2026-10-30T00:00:00Z'),step=300000,opts={period:50,interval:'5m',now:start+100*step};
const bars=(fn,n=50)=>Array.from({length:n},(_,i)=>{const p=fn(i);return {openTime:start+i*step,closeTime:start+(i+1)*step-1,open:p,close:p,high:p+1,low:p-1};});
test('OLS recovers known slopes, constant prices and next-bar conditional midpoint',()=>{
 for(const slope of [2,-.5,0]){const a=analyze(bars(i=>100+slope*i),opts);assert.equal(a.ready,true);assert.equal(a.slope,slope);assert.equal(a.intercept,100);assert.equal(a.sigma,0);assert.equal(a.nextMiddle,100+slope*50);assert.equal(a.r2,slope===0?null:1);assert.equal(a.location,'INSIDE');assert.equal(levels(a,start+10*step).middle,100+slope*10);assert.match(describe(a),/לא סיכויי הצלחה/);}
});
test('bands use RMS residuals about the fitted line, with configurable width and accurate price location',()=>{
 const input=bars(i=>100+i+(i===49?8:0));const a=analyze(input,opts),b=analyze(input,{...opts,deviations:3});
 const expected=Math.sqrt(input.reduce((s,v,i)=>s+(v.close-a.intercept-a.slope*i)**2,0)/50);assert.ok(Math.abs(a.sigma-expected)<1e-10);assert.equal(a.width,2*expected);assert.equal(b.width,3*expected);assert.equal(a.location,'ABOVE');assert.ok(a.r2>0&&a.r2<1);
 assert.equal(analyze(bars(i=>100+i-(i===49?8:0)),opts).location,'BELOW');
});
test('open/future bars do not alter fit; gaps, duplicates and malformed OHLC require new contiguous evidence',()=>{
 const input=bars(i=>100+i),base=analyze(input,opts);
 const extra={...input.at(-1),openTime:start+50*step,closeTime:start+51*step-1,open:999,close:999,high:1000,low:998,closed:false};assert.equal(analyze([...input,extra],opts).slope,base.slope);
 assert.equal(analyze([...input,{...extra,closed:true,openTime:start+101*step,closeTime:start+102*step}],opts).slope,base.slope);
 for(const invalid of [input.slice(1),input.filter((_,i)=>i!==25),[...input.slice(0,26),input[25],...input.slice(26)],input.map((b,i)=>i===25?{...b,high:0}:b)])assert.equal(analyze(invalid,opts).ready,false);
 assert.equal(analyze(input,{...opts,period:200}).ready,false);assert.equal(analyze(input,{...opts,deviations:0}).ready,false);assert.equal(analyze(input,{...opts,interval:'bad'}).ready,false);
});
test('drawing is clipped to measured candles and all three channel lines appear on held-position and analysis renderer',()=>{
 const input=bars(i=>100+i+Math.sin(i)),a=analyze(input,opts),calls=[],ctx=new Proxy({},{get:(_,k)=>(...v)=>calls.push([k,...v]),set:()=>true});
 draw({ctx,analysis:a,view:input.slice(-20),x:i=>i*5,y:p=>500-p,bounds:{left:0,right:100,top:0,bottom:500}});assert.ok(calls.some(c=>c[0]==='clip'));assert.equal(calls.filter(c=>c[0]==='stroke').length,3);assert.equal(calls.filter(c=>c[0]==='fill').length,1);
 const server=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8'),html=fs.readFileSync(new URL('../binance-agent.html',import.meta.url),'utf8');const map=vm.runInNewContext('('+server.slice(server.indexOf('  const sf={')+11,server.indexOf('\n  };',server.indexOf('  const sf={'))+4)+')');
 for(const asset of ['/regression-trend.js','/resistance-patterns.js']){assert.ok(html.includes('src="'+asset));assert.ok(fs.existsSync(new URL('../'+map[asset][0],import.meta.url)));}
});
