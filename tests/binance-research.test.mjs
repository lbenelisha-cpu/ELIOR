import test from 'node:test';
import assert from 'node:assert/strict';
import {compareCryptoPortfolios,simulateCryptoPortfolio} from '../lib/binance-research-engine.mjs';
import {fetchCryptoHistory,normalizeCryptoBars,DAY} from '../lib/binance-research-data.mjs';
const bars=(n=600)=>Array.from({length:n},(_,i)=>{const close=100+i*.1,open=close;return {date:new Date(Date.UTC(2020,0,1+i)).toISOString().slice(0,10),open,close,high:close+1,low:close-1};});
const markets=(n=7,rows=bars())=>Array.from({length:n},(_,i)=>({symbol:'COIN'+i+'USDT',bars:rows}));
test('six equal slots include both cost components and seventh waits',()=>{
 const r=simulateCryptoPortfolio(markets(),'ma200');assert.equal(Object.keys(r.positions).length,6);assert.ok(Math.abs(r.cash)<1e-8);assert.equal(r.journal.length,6);
 for(const j of r.journal){assert.ok(Math.abs(j.amount-10000/6)<1e-7);assert.ok(j.signalDate<j.date);assert.ok(j.price>120.3);}
 assert.ok(r.curve.every(p=>p.held<=6&&p.cash>=-1e-7));assert.equal(r.holdSymbols.length,6);
});
test('next-open execution is used, sales precede buys, proceeds fund equal new slots',()=>{
 const b=bars(208).map((b,i)=>{const close=i<202?100:({202:105,203:106,204:50,205:110,206:110,207:110})[i],open=i===203?110:i===205?60:close;return {...b,open,close,high:Math.max(open,close)+1,low:Math.min(open,close)-1};});
 const r=simulateCryptoPortfolio(markets(6,b),'ma200',{slippagePct:0}),buy=r.journal.filter(j=>j.type==='BUY'),sell=r.journal.filter(j=>j.type==='SELL');assert.equal(sell.length,6);assert.equal(buy.length,12);
 assert.equal(buy[0].date,b[203].date);assert.equal(buy[0].price,110);assert.equal(sell[0].date,b[205].date);assert.equal(sell[0].price,60);
 const proceeds=sell.reduce((n,j)=>n+j.amount,0);for(const j of buy.slice(6)){assert.equal(j.date,b[206].date);assert.ok(Math.abs(j.amount-proceeds/6)<1e-7);}assert.ok(r.cash<1e-7);
});
test('three eligible assets retain cash for the three remaining slots',()=>{
 const r=simulateCryptoPortfolio(markets(3),'ma200');assert.equal(Object.keys(r.positions).length,3);assert.ok(Math.abs(r.cash-5000)<1e-7);
});
test('ranking and strategy choice use no future prices; input remains intact',()=>{
 const m=markets(3),before=JSON.stringify(m),r=compareCryptoPortfolios(m),cut=r.periods[0].endDate;
 const modified=m.map(x=>({...x,bars:x.bars.map(b=>b.date<=cut?b:{...b,open:10,close:10,high:11,low:9})})),s=compareCryptoPortfolios(modified);assert.equal(r.selectedId,s.selectedId);assert.equal(JSON.stringify(m),before);
 for(const x of r.results){const y=s.results.find(y=>y.method.id===x.method.id);assert.deepEqual(x.tests[0],y.tests[0]);assert.equal(x.score,y.score);}
});
test('each chronological period begins in cash and signals precede execution',()=>{
 const r=compareCryptoPortfolios(markets(3));for(const x of r.results)for(const t of x.tests){assert.equal(t.curve[0].value,10000);assert.equal(t.curve[0].held,0);assert.ok(t.journal.every(j=>j.signalDate>=t.startDate&&j.signalDate<j.date));assert.ok(t.curve.every(p=>p.held<=6));}
});
test('invalid costs, duplicate universe, candle gaps and insufficient overlap fail',()=>{
 assert.throws(()=>simulateCryptoPortfolio(markets(3),'ma200',{feePct:-1}));assert.throws(()=>simulateCryptoPortfolio(markets(3),'unknown'));
 const m=markets(3);m[1].symbol=m[0].symbol;assert.throws(()=>compareCryptoPortfolios(m));assert.throws(()=>normalizeCryptoBars(bars().filter((_,i)=>i!==300)));assert.throws(()=>compareCryptoPortfolios(markets(3,bars(300))));
});
test('public history paginates backwards with <=1000 limit and omits current UTC day',async()=>{
 const now=Date.UTC(2026,9,6,8),calls=[],fetcher=async url=>{calls.push(url);assert.equal(url.origin,'https://data-api.binance.vision');assert.equal(url.pathname,'/api/v3/klines');assert.ok(Number(url.searchParams.get('endTime'))<Math.floor(now/DAY)*DAY);const limit=Number(url.searchParams.get('limit'));assert.ok(limit<=1000);const last=Math.floor(Number(url.searchParams.get('endTime'))/DAY)*DAY;return {ok:true,json:async()=>Array.from({length:limit},(_,i)=>{const t=last-(limit-1-i)*DAY;return [t,'100','101','99','100','1',t+DAY-1];})};};
 const r=await fetchCryptoHistory('BTCUSDT',1825,{fetcher,now});assert.equal(calls.length,2);assert.equal(r.bars.length,1825);assert.equal(r.bars.at(-1).date,'2026-10-05');assert.ok(Number(calls[1].searchParams.get('endTime'))<Number(calls[0].searchParams.get('endTime')));
});
test('rate limit stops fetching; stale or malformed responses are rejected',async()=>{
 let calls=0;await assert.rejects(fetchCryptoHistory('BTCUSDT',730,{fetcher:async()=>{calls++;return {ok:false,status:429};}}),e=>e.status===429);assert.equal(calls,1);
 await assert.rejects(fetchCryptoHistory('BTCUSDT',730,{now:Date.UTC(2026,9,6),fetcher:async()=>({ok:true,json:async()=>[[0,1,1,1,1,1,0]]})}));
});
