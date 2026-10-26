import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzePositionAlpha,compactPositionAlpha,cachedPositionAlpha,positionQuoteChange} from '../lib/position-alpha.mjs';
import {makeAuditRecord,collectAudit} from '../lib/ma-decision-audit.mjs';
import {createColmexAudit} from '../lib/colmex-ma-audit.mjs';
const start=Date.UTC(2026,9,26,14),step=300000,position={id:'p1',entryPrice:100,entryAt:new Date(start).toISOString()};
const bars=prices=>prices.map((close,i)=>({openTime:start+i*step,closeTime:start+(i+1)*step-1,open:close,high:close,low:close,close}));
const measure=(prices,p=position)=>analyzePositionAlpha(bars(prices),p,{now:start+prices.length*step});
test('profitable but falling and losing but recovering are independent observations',()=>{
 const profit=measure([110,109,108,106,105]);assert.equal(profit.status,'READY');assert.ok(Math.abs(profit.fromEntry.changePct-5)<1e-10);assert.ok(profit.fromEntry.angle>0);assert.ok(profit.recent.angle<0);assert.equal(profit.recent.minutes,20);
 const loss=measure([95,96,97,97.5,98]);assert.ok(loss.fromEntry.angle<0);assert.ok(loss.recent.angle>0);
});
test('HLC3 uses a full closed candle after entry and ignores open/future candles',()=>{
 const b=bars([100,110,999]);Object.assign(b[1],{open:100,high:120,low:90,close:105});b[2].closed=false;
 const p={...position,entryAt:start+1000},result=analyzePositionAlpha(b,p,{now:start+3*step});
 assert.equal(result.series.length,1);assert.equal(result.series[0].price,105);assert.equal(result.asOf,start+2*step);assert.equal(result.historyPartial,false);
 assert.equal(analyzePositionAlpha(bars([100]),p,{now:start+step}).status,'WAIT_FIRST_CLOSE');
 assert.deepEqual(analyzePositionAlpha(b,p,{now:start+2*step}),{...result,capturedAt:start+2*step});
});
test('fixed scale is denomination invariant and entry pace flattens with elapsed clock time',()=>{
 const a=measure([100.05]);assert.ok(Math.abs(a.fromEntry.angle-45)<1e-8);
 const b=bars([100.05]).map(v=>Object.fromEntries(Object.entries(v).map(([k,n])=>[k,['open','high','low','close'].includes(k)?n*.00001:n])));
 const scaled=analyzePositionAlpha(b,{...position,entryPrice:.001},{now:start+step});assert.ok(Math.abs(scaled.fromEntry.angle-a.fromEntry.angle)<1e-8);
 const older=measure([100.05,100.05]);assert.ok(older.fromEntry.angle<a.fromEntry.angle);assert.equal(measure([100,100,100,100,100]).recent.angle,0);
});
test('gaps cannot create a recent trend, including an overnight session; partial history is explicit',()=>{
 const b=bars([101,102,103,104,105]);for(let i=2;i<b.length;i++){b[i].openTime+=86400000;b[i].closeTime+=86400000;}
 const result=analyzePositionAlpha(b,position,{now:b.at(-1).closeTime+1});assert.equal(result.status,'READY');assert.equal(result.historyPartial,true);assert.equal(result.recent.status,'WAIT_WINDOW');
 const truncated=analyzePositionAlpha(bars([101,102,103,104,105,106]).slice(1),position,{now:start+6*step});assert.equal(truncated.historyPartial,true);assert.equal(truncated.recent.status,'READY');
});
test('bad source data, stale data, adopted times and changed cost basis do not masquerade as current readings',()=>{
 for(const b of [bars([100,101]).reverse(),bars([100,101]).concat(bars([101])[0]),bars([100]).map(b=>({...b,high:99})),bars([100]).map(b=>({...b,closeTime:b.openTime+60000}))])assert.equal(analyzePositionAlpha(b,position,{now:start+5*step}).status,'INVALID_DATA');
 assert.equal(analyzePositionAlpha(bars([101]),position,{now:start+4*step}).status,'STALE');
 assert.equal(measure([100],{...position,adoptedAt:start}).status,'ENTRY_TIME_UNVERIFIED');
 assert.equal(measure([100],{...position,accountingAdjusted:true}).status,'ENTRY_BASIS_CHANGED');
 assert.equal(measure([100],null).status,'NO_POSITION');
 assert.equal(measure([100],{...position,entryAt:start+2*step}).status,'INVALID_ENTRY_TIME');
});
test('SHORT mirrors quote P/L, not price alpha; stale, future and absent quotes have no live P/L',()=>{
 const now=start+5*step,s=measure([105,104,103,102,101],{...position,side:'SHORT'});assert.ok(s.fromEntry.angle>0);assert.ok(s.recent.angle<0);
 assert.ok(positionQuoteChange(s.reference,101,now,now).grossPnlPct<0);
 for(const at of [null,now-15001,now+1])assert.equal(positionQuoteChange(s.reference,101,at,now),null);
});
test('cached snapshots bind to the exact position reference and cannot use future data',()=>{
 const s=compactPositionAlpha(measure([101,102,103,104,105])),at=start+5*step;assert.equal(s.series,undefined);
 assert.deepEqual(cachedPositionAlpha(s,position,at),s);
 assert.equal(cachedPositionAlpha(s,{...position,id:'new-position'},at).status,'WAIT_FIRST_CLOSE');
 assert.equal(cachedPositionAlpha(s,position,at-1).status,'WAIT_FIRST_CLOSE');
 assert.equal(cachedPositionAlpha(s,position,at+600001).status,'STALE');
 assert.equal(s.status,'READY');
});
test('audit freezes both alphas per candle, retains old format, and samples a changed 5m close within a 10m bucket',()=>{
 const b=bars([110,109,108,107,106,105]),at=start+5*step;
 const make=(now,source)=>makeAuditRecord({platform:'BINANCE',symbol:'BTCUSDT',at:now,action:'HOLD',price:105,priceAt:now,position,positionBars:source});
 const a=make(at,b),state={};assert.equal(a.positionAlpha.series,undefined);assert.ok(a.positionAlpha.fromEntry.angle>0);assert.ok(a.positionAlpha.recent.angle<0);
 assert.equal(collectAudit(state,a),true);assert.equal(collectAudit(state,make(at+1000,b)),false);assert.equal(collectAudit(state,make(at+step,b)),true);
 b[0].high=999;assert.equal(a.positionAlpha.fromEntry.changePct,6.000000000000005);
 assert.equal(a.version,'MA100_200_OBSERVATION_V1');
});
test('Colmex reads old MA contexts and new position contexts without cross-position reuse',()=>{
 const at=start+5*step,p=structuredClone(position),state={positions:[{...p,symbol:'AAPL'}]},contexts={AAPL:{checks:[],positionAlpha:compactPositionAlpha(measure([110,109,108,107,106]))}};
 const observe=createColmexAudit(state,contexts,()=>at);observe({symbol:'AAPL',action:'HOLD',price:106,priceAt:at});assert.equal(state.maAudit.rows[0].positionAlpha.status,'READY');
 state.positions[0].id='p2';observe({symbol:'AAPL',action:'HOLD',price:106,priceAt:at});assert.equal(state.maAudit.rows[1].positionAlpha.status,'WAIT_FIRST_CLOSE');
 const old={};createColmexAudit(old,{AAPL:[]},()=>at)({symbol:'AAPL',action:'WAIT'});assert.equal(old.maAudit.rows[0].positionAlpha.status,'NO_POSITION');
});
