import test from 'node:test';
import assert from 'node:assert/strict';
import {compareScenarios,SCENARIOS} from '../lib/meitav-experiments.mjs';
import {backtestLegacyWave as backtestDaily} from '../lib/legacy-wave-backtest.mjs';
const rows=(n=350)=>Array.from({length:n},(_,i)=>({date:new Date(Date.UTC(2020,0,1+i)).toISOString().slice(0,10),close:i<200?90:[100,98,102,103,110,100,103,104,105,104][(i-200)%10]}));
test('nine fixed scenarios share dates, fees and benchmark without mutating input',()=>{
 const b=rows(),copy=JSON.stringify(b),r=compareScenarios(b,.1);assert.equal(r.results.length,9);assert.equal(new Set(SCENARIOS.map(s=>s.id)).size,9);assert.equal(JSON.stringify(b),copy);
 assert.equal(r.selectedId,r.results[0].scenario.id);assert.equal(r.trainDays+r.validationDays,b.length-202);
 for(const x of r.results){assert.ok(Number.isFinite(x.train.returnPct));assert.ok(Number.isFinite(x.validation.returnPct));assert.equal(x.validation.holdReturnPct,r.results[0].validation.holdReturnPct);assert.ok(x.train.endDate<x.validation.startDate);assert.ok(x.validation.maxDrawdown>=0);assert.ok(x.validation.journal.every(j=>j.signalDate<j.date&&j.signalDate>=x.validation.startDate));}
});
test('base scenario reproduces archived wave backtest on first period',()=>{
 const b=rows(),r=compareScenarios(b),base=r.results.find(x=>x.scenario.id==='base'),expected=backtestDaily(b.slice(0,202+r.trainDays));
 assert.equal(base.train.returnPct,expected.returnPct);assert.equal(base.train.maxDrawdown,expected.maxDrawdown);assert.equal(base.train.actions,expected.trades);
});
test('future prices cannot change the chosen scenario or training metrics',()=>{
 const b=rows(),r=compareScenarios(b),cut=202+r.trainDays,changed=b.map((x,i)=>i<cut?x:{...x,close:20+i});const other=compareScenarios(changed);
 assert.equal(other.selectedId,r.selectedId);
 for(const x of r.results){const y=other.results.find(y=>y.scenario.id===x.scenario.id);assert.deepEqual(y.train,x.train);}
});
test('validation starts fresh and never carries training holdings or pending signals',()=>{
 const r=compareScenarios(rows());for(const x of r.results){assert.equal(x.validation.curve[0].value,10000);assert.ok(x.validation.journal.every(j=>j.date>x.validation.startDate));}
});
test('short samples and invalid fees fail clearly',()=>{
 assert.throws(()=>compareScenarios(rows(261)),/262/);assert.equal(compareScenarios(rows(262)).validationDays,18);assert.throws(()=>compareScenarios(rows(),NaN));assert.throws(()=>compareScenarios(rows(),6));
});
