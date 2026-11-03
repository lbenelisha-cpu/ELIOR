import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PocPaperLedger} from '../lib/poc-paper-ledger.mjs';
import {PocPaperService} from '../lib/poc-paper-service.mjs';
import {findPocSetup,volumePoc,verifiedBalance,verifiedQuote} from '../lib/poc-paper-strategy.mjs';
const START=Date.UTC(2026,10,3,12);
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'poc-paper-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let at=START;const file=path.join(dir,'state.json'),ledger=new PocPaperLedger({file,now:()=>at});return {ledger,file,time:()=>at,advance:ms=>at+=ms};}
function seed(f){f.ledger.balances({LONG:{equity:150,free:30,at:f.time(),complete:true},SHORT:{equity:70,free:36,at:f.time(),complete:true}});}
function setup(f,side='LONG',symbol='ETHUSDT',id='first'){return {id,side,symbol,poc:100,stop:side==='LONG'?95:105,confirmedAt:f.time(),historyAt:Math.floor(f.time()/300000)*300000,expiresAt:f.time()+7200000};}
function quote(f,long,short,spread=0){f.ledger.observe({LONG:long==null?{}:{ETHUSDT:{bid:long,ask:long+spread,at:f.time()}},SHORT:short==null?{}:{ETHUSDT:{bid:short,ask:short+spread,at:f.time()}}});}
test('seeds once from verified full equity, not free cash; no fabricated old balances',t=>{
 const f=fixture(t);for(const b of [{equity:150,free:30,at:START,complete:false},{equity:null,free:30,at:START,complete:true},{equity:150,free:30,at:START-90001,complete:true}])f.ledger.balances({LONG:b});
 assert.equal(f.ledger.snapshot().accounts[0].seed,undefined);seed(f);assert.equal(f.ledger.snapshot().accounts[0].seed,150);assert.equal(f.ledger.snapshot().accounts[1].seed,70);
 f.ledger.balances({LONG:{equity:170,free:50,at:START,complete:true}});assert.equal(f.ledger.snapshot().accounts[0].seed,150);assert.equal(f.ledger.snapshot().accounts[0].live.equity,170);assert.equal(f.ledger.snapshot().accounts[1].live,null);
 f.advance(90001);assert.equal(f.ledger.snapshot().accounts[0].live,null);
});
test('LONG reclaim enters inside candle, uses ask, exits bid intrabar; fees and account reconcile',t=>{
 const f=fixture(t);seed(f);f.ledger.setup('LONG','ETHUSDT',setup(f));quote(f,101);assert.equal(Object.keys(f.ledger.state.accounts.LONG.positions).length,0);
 f.advance(1000);quote(f,99);f.advance(1000);quote(f,100.1,null,.1);
 const a=f.ledger.state.accounts.LONG,p=a.positions.ETHUSDT;assert.ok(Math.abs(p.entry-100.2)<1e-10);assert.equal(p.entryAt,START+2000);assert.equal(p.mark,100.1);assert.ok(p.notional+p.entryFee<=30);
 assert.ok(f.ledger.value('LONG').openPnl<0);f.advance(1000);quote(f,103);f.advance(1000);quote(f,101.9);
 assert.equal(a.closedCount,1);assert.equal(a.closed[0].exit,101.9);assert.equal(a.closed[0].reason,'TRAILING_STOP');assert.equal(f.ledger.value('LONG').equity,a.seed+a.realized);assert.equal(a.entryFees,0);
 f.ledger.setup('LONG','ETHUSDT',setup(f));quote(f,99);quote(f,101);assert.equal(a.closedCount,1);assert.equal(Object.keys(a.positions).length,0);
});
test('SHORT uses futures quotes, reciprocal reclaim, buyback ask and structural stop',t=>{
 const f=fixture(t);seed(f);f.ledger.setup('SHORT','ETHUSDT',setup(f,'SHORT'));quote(f,null,101);f.advance(1000);quote(f,null,99.8,.1);
 const a=f.ledger.state.accounts.SHORT;assert.equal(a.positions.ETHUSDT.entry,99.8);f.advance(1000);quote(f,null,98,.1);f.advance(1000);quote(f,null,99.2,.1);
 assert.equal(a.closed[0].exit,99.3);assert.equal(a.closed[0].reason,'TRAILING_STOP');assert.ok(a.realized>0);
 f.ledger.setup('SHORT','ETHUSDT',{...setup(f,'SHORT','ETHUSDT','second'),stop:100.2});quote(f,null,100.1);quote(f,null,99.9);quote(f,null,106);assert.equal(a.closed.at(-1).reason,'STRUCTURE_STOP');assert.ok(a.closed.at(-1).net<0);
});
test('stale quotes cannot enter or value holdings; gaps flagged, resume fills observed price',t=>{
 const f=fixture(t);seed(f);f.ledger.setup('LONG','ETHUSDT',setup(f));quote(f,99);f.advance(20000);quote(f,101);assert.equal(Object.keys(f.ledger.state.accounts.LONG.positions).length,0);
 quote(f,99);f.advance(1000);quote(f,101);f.advance(16000);quote(f,null);assert.equal(f.ledger.value('LONG').equity,null);assert.equal(f.ledger.value('LONG').gapTrades,1);
 quote(f,90);const a=f.ledger.state.accounts.LONG;assert.equal(a.closed[0].exit,90);assert.equal(a.closed[0].gap,true);assert.ok(a.realized<0);
});
test('restart preserves seed, trades and totals, disarms pending and marks held gaps',t=>{
 const f=fixture(t);seed(f);f.ledger.setup('LONG','ETHUSDT',setup(f));quote(f,99);quote(f,101);
 f.ledger.setup('SHORT','ETHUSDT',setup(f,'SHORT'));quote(f,101,101);
 const restored=new PocPaperLedger({file:f.file,now:f.time});assert.equal(restored.state.accounts.LONG.seed,150);assert.equal(restored.state.accounts.LONG.positions.ETHUSDT.entry,101);assert.equal(restored.state.accounts.LONG.positions.ETHUSDT.gap,true);assert.equal(restored.state.accounts.SHORT.pending.ETHUSDT.armed,false);
});
test('corrupt disk and write failure cannot silently start a new experiment',t=>{
 const f=fixture(t);fs.writeFileSync(f.file,'broken');const broken=new PocPaperLedger({file:f.file,now:f.time});assert.equal(broken.fatal,'PAPER_JOURNAL_UNREADABLE');broken.balances({LONG:{equity:150,free:150,at:START,complete:true}});assert.equal(fs.readFileSync(f.file,'utf8'),'broken');
 fs.rmSync(f.file);const failed=new PocPaperLedger({file:f.file,now:f.time,save:()=>{throw Error('disk');}});failed.balances({LONG:{equity:150,free:150,at:START,complete:true}});assert.equal(failed.fatal,'PAPER_JOURNAL_WRITE_FAILED');assert.equal(failed.state.accounts.LONG,null);
});
test('daily allocation compounds closed results only, slots and cash are bounded',t=>{
 const f=fixture(t);seed(f);const a=f.ledger.state.accounts.LONG;
 for(let i=0;i<6;i++){const symbol='T'+i+'USDT';f.ledger.setup('LONG',symbol,setup(f,'LONG',symbol,'s'+i));f.ledger.observe({LONG:{[symbol]:{bid:99,ask:99,at:f.time()}}});f.ledger.observe({LONG:{[symbol]:{bid:101,ask:101,at:f.time()}}});}
 assert.equal(Object.keys(a.positions).length,5);assert.ok(Object.values(a.positions).reduce((s,p)=>s+p.notional+p.entryFee,0)<=150);
 const budget=a.dayBudget;f.advance(86400000);f.ledger.observe({});assert.equal(a.dayBudget,budget);assert.equal(a.daily.length,2);assert.equal(a.daily.at(-1).equity,null);
});
function candles(){const anchors=[[0,105],[5,100],[10,110],[15,103],[20,113],[25,106],[30,116],[35,109],[40,119],[45,112],[49,118]],rows=[];for(let i=0;i<50;i++){let j=0;while(anchors[j+1][0]<i)j++;const [a,x]=anchors[j],[b,y]=anchors[j+1],price=x+(y-x)*(i-a)/(b-a);for(let k=0;k<5;k++){const at=START-15000000+i*300000+k*60000;rows.push([at,price,price+.2,price-.2,price,10,at+59999]);}}return rows;}
test('causal 50-bar higher/lower swing POC; gaps and invalid candles rejected',()=>{
 const raw=candles(),s=findPocSetup(raw,'ETHUSDT','LONG',START);assert.equal(s.side,'LONG');assert.ok(s.confirmedAt<START);assert.ok(s.stop<s.poc);assert.equal(findPocSetup(raw,'ETHUSDT','SHORT',START),null);
 const future=[START,999,999,999,999,999,START+59999];assert.deepEqual(findPocSetup([...raw,future],'ETHUSDT','LONG',START),s);
 assert.throws(()=>findPocSetup(raw.filter((_,i)=>i!==12),'ETHUSDT','LONG',START),/GAP/);assert.throws(()=>findPocSetup([[START-60000,100,90,80,100,1,START-1]],'ETHUSDT','LONG',START),/INVALID/);
 const inverted=raw.map(r=>[r[0],250-r[1],250-r[3],250-r[2],250-r[4],r[5],r[6]]);assert.equal(findPocSetup(inverted,'ETHUSDT','SHORT',START).side,'SHORT');
});
test('POC volume tie rules; invalid/future prices and nulls do not turn into zero',()=>{
 const rows=[{low:100,high:124,volume:24}];assert.equal(volumePoc(rows,'LONG'),123.5);assert.equal(volumePoc(rows,'SHORT'),100.5);
 assert.equal(verifiedQuote({bid:1,ask:2,at:START+2000},START),null);assert.equal(verifiedQuote({bid:null,ask:2,at:START},START),null);assert.equal(verifiedBalance({equity:null,free:0,at:START,complete:true},START),null);
});
test('service reads accounts independently, refuses partial valuations and only invokes GET capabilities',async t=>{
 const f=fixture(t),routes=[];let failLong=false;const service=new PocPaperService({ledger:f.ledger,now:f.time,symbols:()=>['ETHUSDT'],spotAccount:async()=>{if(failLong)throw Error('offline');return {connected:true,totalValueUsdt:150,usdtFree:30,balances:[{qty:1,usdtPrice:120}],updatedAt:new Date(START).toISOString()};},spotGet:async route=>{routes.push(route);return [];},futuresGet:async route=>{routes.push(route);return {multiAssetsMargin:false,assets:[{asset:'USDT',walletBalance:'70',unrealizedProfit:'2',availableBalance:'36'}]};}});
 await service.accounts();assert.equal(f.ledger.state.accounts.SHORT.seed,72);assert.equal(f.ledger.state.accounts.LONG.seed,150);failLong=true;await service.accounts();assert.equal(f.ledger.live.LONG,null);assert.equal(f.ledger.live.SHORT.equity,72);await service.quotes();assert.ok(routes.every(r=>r==='/fapi/v2/account'||r.includes('ticker/bookTicker')));
});
