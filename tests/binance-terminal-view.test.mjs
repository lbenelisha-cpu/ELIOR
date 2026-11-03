import test from 'node:test';
import assert from 'node:assert/strict';
import {terminalView} from '../lib/binance-terminal-view.mjs';
const now=Date.UTC(2026,10,3,14);
const snapshot={mode:'live',receivedAt:now,account:{totalValueUsdt:150,usdtFree:50,balances:[{asset:'ETH',qty:.04,usdtPrice:2500,valueUsdt:100,pnlIls:0}]}};
const row={symbol:'ETHUSDT',closedAt:now-1000,netPnlUsdt:1,direction:'LONG',status:'CLOSED'};
const report={ok:true,asOf:now,rows:[row,{...row,direction:'SHORT',netPnlUsdt:-.25}],issues:[]};
test('overview preserves wallet units and separates open P/L from today realized LONG + SHORT',()=>{
 const v=terminalView(snapshot,report,now);assert.equal(v.summary.pnl,0);assert.equal(v.todayNet,.75);assert.equal(v.todayCount,2);assert.equal(v.positions[0].weight,100/150*100);
 assert.equal(v.positions[0].entry,null);assert.equal(v.positions[0].pnl,0);
});
test('Israel calendar day, partial results and unknown values never become full or zero profit',()=>{
 const v=terminalView(snapshot,{...report,rows:[{...row,closedAt:Date.UTC(2026,10,2,22,1)},{...row,closedAt:Date.UTC(2026,10,2,21,59),netPnlUsdt:100},{...row,netPnlUsdt:null}]},now);
 assert.equal(v.todayCount,2);assert.equal(v.todayNet,1);assert.equal(v.partial,true);assert.equal(v.knownCount,1);
 assert.equal(terminalView(snapshot,{...report,rows:[]},now).todayNet,null);
 assert.equal(terminalView(snapshot,{...report,loadingShort:true},now).partial,true);
 assert.equal(terminalView(snapshot,{...report,issues:['SHORT_JOURNAL_UNAVAILABLE']},now).partial,true);
});
test('failed, expired, future, unauthenticated and demo snapshots cannot expose live accounting',()=>{
 for(const patch of [{error:true},{unauthorized:true},{receivedAt:now-60001},{receivedAt:now+2000},{mode:'demo'}])assert.equal(terminalView({...snapshot,...patch},report,now).reportReady,false);
 for(const patch of [{asOf:now-120001},{asOf:now+2000},{ok:false}])assert.equal(terminalView(snapshot,{...report,...patch},now).todayNet,null);
 assert.equal(terminalView({...snapshot,error:true},report,now).positions.length,0);
});
test('partial wallet hides allocation weights; future transactions are excluded and recent table bounded',()=>{
 const v=terminalView({...snapshot,account:{...snapshot.account,unpricedAssets:['BTC']}},{...report,rows:[{...row,closedAt:now+1},...Array.from({length:8},(_,i)=>({...row,closedAt:now-1000-i}))]},now);
 assert.equal(v.positions[0].weight,null);assert.equal(v.closed.length,6);assert.equal(v.todayCount,8);
});
