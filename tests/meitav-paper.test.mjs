import test from 'node:test';
import assert from 'node:assert/strict';
import {createPaper,normalizeBars,runPaperCycle,paperValue,backtestDaily,restorePaperState} from '../lib/meitav-paper.mjs';
const pattern=[100,90,80,85,92,87,82,84,86,85,86,78,79,80,81];
const bars=(tail=pattern)=>[...Array(200).fill(90),...tail].map((close,i)=>({date:new Date(Date.UTC(2020,0,1+i)).toISOString().slice(0,10),open:close,high:close,low:close,close}));
const markets=(n=7,tail)=>Array.from({length:n},(_,i)=>({symbol:'STOCK'+i,currency:'USD',bars:bars(tail)}));
test('six equal funded slots include entry fees and leave seventh unbought',()=>{
 const p=createPaper(12000);runPaperCycle(p,markets());assert.equal(Object.keys(p.positions).length,6);assert.ok(Math.abs(p.cash)<1e-8);
 for(const x of Object.values(p.positions))assert.ok(Math.abs(x.cost-2000)<1e-8);
 assert.ok(Math.abs(paperValue(p)-12000/1.001)<1e-7);
});
test('repeated close does not duplicate trades; later stop sells without immediate rebuy',()=>{
 const p=createPaper();const m=markets(1);runPaperCycle(p,m);const count=p.journal.length;runPaperCycle(p,m);assert.equal(p.journal.length,count);
 runPaperCycle(p,markets(1,[...pattern,75]));assert.equal(Object.keys(p.positions).length,0);assert.equal(p.journal[0].type,'SELL');assert.ok(p.cash>0);
});
test('invalid and duplicate dates, short histories and nonpositive prices are rejected',()=>{
 for(const rows of [bars().slice(0,2),[...bars(),bars()[0]],bars().map((b,i)=>i?b:{date:'2020-02-31',close:90}),bars().map((b,i)=>i?b:{...b,close:0})])assert.throws(()=>normalizeBars(rows));
});
test('wrong currency is excluded and unsorted histories are normalized',()=>{
 const p=createPaper();runPaperCycle(p,[{...markets(1)[0],currency:'ILS'}]);assert.equal(p.journal.length,0);
 const m=markets(1);m[0].bars.reverse();runPaperCycle(p,m);assert.equal(p.journal[0].price,81);
});
test('historical signal is executed only on subsequent close',()=>{
 assert.equal(backtestDaily(bars()).trades,0);
 const r=backtestDaily(bars([...pattern,82]));assert.equal(r.trades,1);assert.ok(Math.abs(r.value-10000/1.001)<1e-7);assert.throws(()=>backtestDaily(bars(),-1));
});
test('saved state survives JSON roundtrip and rejects corrupt funds',()=>{
 const p=createPaper();const m=markets(1);runPaperCycle(p,m);const s=restorePaperState(JSON.parse(JSON.stringify({paper:p,markets:m})));runPaperCycle(s.paper,s.markets);assert.equal(s.paper.journal.length,1);
 s.paper.cash=-1;assert.throws(()=>restorePaperState(s));
});
