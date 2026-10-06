import test from 'node:test';
import assert from 'node:assert/strict';
import {compareMethods,simulateMethod,methodSignals,METHODS} from '../lib/meitav-research.mjs';
const bars=(n=600,offset=0)=>Array.from({length:n},(_,i)=>({date:new Date(Date.UTC(2018,0,1+i)).toISOString().slice(0,10),close:100+offset+i*.1+Math.sin(i/7)*3}));
const markets=()=>['AAA','BBB','CCC'].map((symbol,i)=>({symbol,currency:'USD',source:'test',bars:bars(600,i*10)}));
test('four methods use common date ranges and preserve all input',()=>{
 const m=markets(),before=JSON.stringify(m),r=compareMethods(m);assert.equal(r.results.length,4);assert.equal(JSON.stringify(m),before);assert.equal(r.selectedId,r.results[0].method.id);
 for(const x of r.results)for(const a of x.assets)for(let i=0;i<3;i++){const p=a.periods[i];assert.equal(p.startDate,r.periods[i].startDate);assert.equal(p.endDate,r.periods[i].endDate);assert.ok(Number.isFinite(p.returnPct));assert.ok(p.maxDrawdown>=0);assert.ok(p.journal.every(j=>j.signalDate<j.date&&j.signalDate>=p.startDate));}
});
test('later prices cannot alter training scores or chosen method',()=>{
 const m=markets(),r=compareMethods(m),cut=r.periods[0].endDate;
 const changed=m.map(x=>({...x,bars:x.bars.map(b=>b.date<=cut?b:{...b,close:b.close*.3})})),s=compareMethods(changed);
 assert.equal(s.selectedId,r.selectedId);for(const x of r.results){const y=s.results.find(y=>y.method.id===x.method.id);assert.equal(x.score,y.score);assert.deepEqual(x.summary[0],y.summary[0]);}
});
test('signals are causal and momentum decides only on month boundary',()=>{
 const b=bars();for(const m of METHODS){const full=methodSignals(b,m.id),prefix=methodSignals(b.slice(0,400),m.id);assert.deepEqual(prefix,full.slice(0,400));}
 const s=methodSignals(b,'momentum');for(let i=252;i<b.length;i++)if(b[i].date.slice(0,7)===b[i-1].date.slice(0,7))assert.ok(!s[i].buy&&!s[i].sell);
});
test('entry at next close includes fee and execution costs and does not force final sale',()=>{
 const b=bars(300),start=b[252].date,end=b[253].date,r=simulateMethod(b,'ma200',{feePct:1,slippagePct:1,startDate:start,endDate:end});assert.equal(r.actions,1);assert.equal(r.journal[0].date,end);assert.equal(r.journal[0].signalDate,start);assert.ok(Math.abs(r.value-10000/(1.01*1.01))<1e-7);assert.ok(r.openPosition);assert.ok(r.fees>0);
 assert.equal(r.curve[0].value,10000);assert.ok(r.holdReturnPct<0);
});
test('missing overlap, duplicate symbols, mixed currencies and invalid costs rejected',()=>{
 assert.throws(()=>compareMethods(markets().slice(1)),/שלוש/);assert.throws(()=>compareMethods(markets().map(x=>({...x,bars:x.bars.slice(0,400)}))),/180/);
 const m=markets();m[1].symbol=m[0].symbol;assert.throws(()=>compareMethods(m));m[1].symbol='BBB';m[1].currency='ILS';assert.throws(()=>compareMethods(m));assert.throws(()=>compareMethods(markets(),{slippagePct:-1}));
});
test('aggregate values are simple means of separate stock experiments',()=>{
 const r=compareMethods(markets());for(const x of r.results)for(let i=0;i<3;i++){const average=x.assets.reduce((n,a)=>n+a.periods[i].returnPct,0)/3;assert.equal(average,x.summary[i].meanReturn);assert.equal(x.summary[i].actions,x.assets.reduce((n,a)=>n+a.periods[i].actions,0));}
});
