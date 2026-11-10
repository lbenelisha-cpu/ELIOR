import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context={};vm.runInNewContext(fs.readFileSync(new URL('../position-barriers.js',import.meta.url),'utf8'),context);
const api=context.LEVI_POSITION_BARRIERS,now=Date.parse('2026-11-11T00:00:00Z');
function position(side='LONG'){
 return {symbol:'ABCUSDT',side,qty:2,entryPrice:100,entryAt:now-600000,positionQuoteAt:now-1000,price:side==='LONG'?108:92,
  effectiveStopPrice:side==='LONG'?106:94,targetPrice:side==='LONG'?150:50,activationPrice:side==='LONG'?105:95,
  exitPolicy:side==='LONG'?'PROFIT_ACTIVATE5_TRAIL1PP_STOP1_V2':'COLMEX_CHANNEL_SHORT_EXIT_V1',profitFloorArmed:true,
  stopLossPct:25,takeProfitPct:200,profitActivationPct:30,trailingGapPp:20};
}
for(const side of ['LONG','SHORT'])test(side+' uses exact server levels, independently of settings and chart prices',()=>{
 const p=position(side),before=JSON.stringify(p),m=api.levels(p,{now});
 assert.equal(m.lines.length,4);assert.equal(m.stop,side==='LONG'?106:94);assert.equal(m.target,side==='LONG'?150:50);
 assert.equal(m.lines.find(x=>x.kind==='stop').pct.toFixed(2),'6.00');assert.equal(m.lines.find(x=>x.kind==='target').pct,50);
 assert.equal(m.activation,side==='LONG'?105:95);assert.equal(m.stale,false);assert.equal(JSON.stringify(p),before);
 p.effectiveStopPrice=side==='LONG'?107:93;assert.equal(api.levels(p,{now}).stop,p.effectiveStopPrice);
});
test('snapshot adapters keep Spot and Futures of the same symbol separate and remove closed positions',()=>{
 const long=position(),short={...position('SHORT'),effectiveStopPrice:undefined,stopPrice:94,exitPolicy:'FUTURES_SHORT_SETTINGS_V2'};
 const s={mode:'live',agent:{agents:[{symbol:'ABCUSDT',position:'LONG',strategy:long}]},account:{connected:true,updatedAt:now-1000,balances:[{asset:'ABC',qty:2}]},shortTrading:{checkedAt:now-1000,account:{},positions:[short]}};
 assert.equal(api.fromSnapshot(s,'ABCUSDT',now).side,'LONG');assert.equal(api.fromSnapshot({...s,venue:'BINANCE_FUTURES'},'ABCUSDT',now).stop,94);
 s.shortTrading.positions=[];assert.equal(api.fromSnapshot({...s,venue:'BINANCE_FUTURES'},'ABCUSDT',now),null);
 s.account.balances[0].qty=1;assert.equal(api.fromSnapshot(s,'ABCUSDT',now),null);
});
for(const side of ['LONG','SHORT'])test('Colmex '+side+' resolves managed position and rejects another ticker',()=>{
 const p={...position(side),symbol:'AAPL'},s={venue:'COLMEX',status:{live:true,lastBrokerSnapshotAt:now-1000,positions:[p]}};
 assert.equal(api.fromSnapshot(s,'AAPL',now).side,side);assert.equal(api.fromSnapshot(s,'MSFT',now),null);
 s.status.positions=[];assert.equal(api.fromSnapshot(s,'AAPL',now),null);
});
test('expired, missing or future timestamps keep labelled historical levels without claiming freshness',()=>{
 for(const change of [p=>p.positionQuoteAt=now-120001,p=>p.positionQuoteAt=null,p=>p.positionQuoteAt=now+1]){
  const p=position();change(p);const m=api.levels(p,{now});assert.equal(m.stale,true);assert.equal(m.lines.length,4);
 }
 assert.equal(api.levels(position(),{now,unavailable:true}).stale,true);
 assert.equal(api.levels(position(),{now,observedAt:now-120001}).stale,true);
});
test('missing thresholds are not manufactured, and unsupported or invalid positions have no map',()=>{
 const p=position();delete p.effectiveStopPrice;delete p.activationPrice;p.targetPrice=80;
 const m=api.levels(p,{now});assert.equal(m.missing,true);assert.equal(m.lines.length,1);assert.equal(m.stop,null);
 for(const bad of [{...p,qty:0},{...p,side:'SELL'},{...p,entryPrice:NaN},{...p,exitPolicy:'UNKNOWN'},{...p,entryAt:now+1}])assert.equal(api.levels(bad,{now}),null);
});
test('renderer replaces closed/changed positions, labels all four levels and fits tiny prices',()=>{
 const make=tag=>({tag,children:[],attrs:{},style:{setProperty(){}},classList:{add(){}},setAttribute(k,v){this.attrs[k]=v;},append(...xs){this.children.push(...xs);},replaceChildren(...xs){this.children=xs;}});
 const document={createElement:make,createElementNS:(_,tag)=>make(tag)},host=make('section');host.ownerDocument=document;
 const p=position();for(const k of ['entryPrice','effectiveStopPrice','targetPrice','activationPrice','price'])p[k]*=1e-8;
 const m=api.levels(p,{now});api.render(host,m);assert.equal(host.hidden,false);
 const all=n=>[n,...n.children.flatMap(all)],nodes=all(host),lines=nodes.filter(x=>x.attrs['data-barrier']);
 assert.equal(lines.length,4);assert.ok(lines.every(x=>Number.isFinite(Number(x.attrs.y1))&&Number(x.attrs.y1)>0&&Number(x.attrs.y1)<180));
 assert.ok(nodes.some(x=>x.textContent?.includes('יעד רווח TP')));assert.ok(nodes.some(x=>x.textContent?.includes('הפעלת הגנת רווח')));
 api.render(host,{...m,stale:true});assert.ok(all(host).some(x=>x.textContent?.includes('נתונים ישנים')));
 api.render(host,null);assert.equal(host.hidden,true);assert.equal(host.children.length,0);
});
test('Colmex imported and paper charts do not attach live position barriers',()=>{
 const source=fs.readFileSync(new URL('../colmex-pro.js',import.meta.url),'utf8');
 const start=source.indexOf(' const actualPosition='),end=source.indexOf("\n add('rect'",start),expression=source.slice(start,end)+'\n result=barrierModel;';
 for(const [paper,manual,expected] of [[false,false,true],[true,false,false],[false,true,false]]){
  let called=0;const ctx={PAPER_MODE:paper,manualCharts:new Set(manual?['AAPL']:[]),selected:'AAPL',liveSearchState:{positions:[{symbol:'AAPL'}]},LEVI_POSITION_BARRIERS:{fromSnapshot(){called++;return {side:'SHORT'};}}};
  vm.runInNewContext(expression,ctx);assert.equal(called,expected?1:0);assert.equal(!!ctx.result,expected);
 }
});
