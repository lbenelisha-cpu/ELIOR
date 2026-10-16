import test from 'node:test';
import assert from 'node:assert/strict';
import {buildColmexMarks,markBarIndex,COLMEX_MARK_TYPES} from '../lib/colmex-chart-marks.mjs';
const base=Date.parse('2026-10-16T14:00:00Z');
const setup=Object.fromEntries(COLMEX_MARK_TYPES.map(([key],i)=>[key,{price:100+i,time:base+i*300000}]));
const position={setup,entryPrice:105,entryAt:new Date(base+1600000).toISOString(),peakPrice:110,peakAt:new Date(base+1700000).toISOString(),effectiveStopPrice:94.5};
test('all six Wyckoff stages, buy and peak carry exact prices/times; active pattern pulses despite journal deduplication',()=>{
 const state={positions:{AAPL:position},assets:{},journal:[{symbol:'AAPL',side:'BUY',price:105,at:position.entryAt,setup}]};const m=buildColmexMarks(state,'AAPL');
 for(const [kind] of COLMEX_MARK_TYPES){assert.equal(m.points.filter(p=>p.kind===kind).length,1);assert.equal(m.points.find(p=>p.kind===kind).pulse,true);}
 assert.ok(m.points.some(p=>p.kind==='buy'&&p.price===105));assert.ok(m.points.some(p=>p.kind==='peak'&&p.price===110&&p.pulse));assert.deepEqual(m.lines.map(x=>x.kind),['buy','peak','stop']);assert.equal(m.cards.length,9);
});
test('sale retains historical pattern, entry, observed peak and sale without blinking or inventing missing timestamps',()=>{
 const sale={symbol:'AAPL',side:'SELL',price:108,at:new Date(base+1800000).toISOString(),entryPrice:105,entryAt:position.entryAt,peakPrice:110,peakAt:position.peakAt,setup};
 let m=buildColmexMarks({positions:{},assets:{},journal:[sale]},'AAPL');assert.ok(m.points.some(p=>p.kind==='sell'&&p.price===108));assert.ok(m.points.some(p=>p.kind==='peak'&&p.at===Date.parse(position.peakAt)));assert.equal(m.points.some(p=>p.pulse),false);assert.deepEqual(m.lines.map(x=>x.kind),['buy','peak','sell']);
 delete sale.peakAt;m=buildColmexMarks({journal:[sale]},'AAPL');assert.equal(m.points.some(p=>p.kind==='peak'),false);assert.equal(m.cards.find(p=>p.kind==='peak').price,110);assert.equal(buildColmexMarks(null,'AAPL').points.length,0);
});
test('closed-candle pivots and observation fills map to their own candles; overnight gaps and offscreen points are excluded',()=>{
 const bars=[0,1,2].map(i=>({date:new Date(base+i*300000).toISOString()}));assert.equal(markBarIndex({at:base+300000,anchor:'close'},bars),0);assert.equal(markBarIndex({at:base+300000,anchor:'event'},bars),1);assert.equal(markBarIndex({at:base-1},bars),-1);assert.equal(markBarIndex({at:base+86400000},bars),-1);
 const overnight=[{date:'2026-10-15T19:55:00Z'},{date:'2026-10-16T13:30:00Z'}];assert.equal(markBarIndex({at:Date.parse('2026-10-16T00:00:00Z')},overnight),-1);
 const daily=[{date:'2026-10-15'},{date:'2026-10-16'}];assert.equal(markBarIndex({at:Date.parse('2026-10-16T15:00:00Z')},daily,'1day'),1);
});
