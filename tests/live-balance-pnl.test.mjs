import test from 'node:test';
import assert from 'node:assert/strict';
import {liveBalancePnl} from '../lib/wyckoff-live-positions.mjs';
test('weighted buys and partial sales preserve cost and include quote fees',()=>{
 const actions=[{symbol:'BELUSDT',type:'SELL',qty:5},{symbol:'BELUSDT',type:'BUY',qty:10,amountUsdt:20,quoteFeeUsdt:1},{symbol:'BELUSDT',type:'BUY',qty:10,amountUsdt:10}];
 const p=liveBalancePnl({asset:'BEL',qty:15,usdtPrice:2,valueUsdt:30},actions);
 assert.equal(p.allocationIls,23.25);assert.equal(p.pnlIls,6.75);assert.equal(p.entryPrice,1.55);
});
test('missing history, mismatched wallet and missing quote never invent profit',()=>{
 const buy=[{symbol:'BELUSDT',type:'BUY',qty:10,amountUsdt:10}];
 for(const [balance,actions] of [[{asset:'BEL',qty:10,usdtPrice:2,valueUsdt:20},[]],[{asset:'BEL',qty:11,usdtPrice:2,valueUsdt:22},buy],[{asset:'BEL',qty:10,usdtPrice:0,valueUsdt:0},buy]])assert.equal(liveBalancePnl(balance,actions).pnlIls,null);
});
test('fees paid in BNB for another pair reconcile BNB quantity without double counting its own buy fee',()=>{
 const actions=[{type:'BUY',symbol:'TRUMPUSDT',qty:12.622,amountUsdt:23.767226,commissions:[{asset:'BNB',amount:.00002434}]},{type:'BUY',symbol:'BNBUSDT',qty:.03897075,amountUsdt:28.43256,commissions:[{asset:'BNB',amount:.00002925}]}];
 const qty=.03894641,p=liveBalancePnl({asset:'BNB',qty,usdtPrice:730,valueUsdt:qty*730},actions);
 assert.ok(Number.isFinite(p.pnlIls));assert.ok(Math.abs(p.entryPrice-28.43256/.03897075)<1e-8);
});
test('a latest documented buy exactly matching the wallet can recover after untracked old dust removal',()=>{
 const actions=[{type:'BUY',symbol:'TRUMPUSDT',qty:12.622,amountUsdt:23.767226},{type:'SELL',symbol:'TRUMPUSDT',qty:14.884},{type:'BUY',symbol:'TRUMPUSDT',qty:14.884101,amountUsdt:28.725272}];
 const p=liveBalancePnl({asset:'TRUMP',qty:12.622,usdtPrice:1.875,valueUsdt:12.622*1.875},actions);
 assert.equal(p.allocationIls,23.767226);assert.ok(p.pnlIls<0);
 assert.equal(liveBalancePnl({asset:'TRUMP',qty:12.7,usdtPrice:1.875,valueUsdt:12.7*1.875},actions).pnlIls,null);
});
test('multiple open purchases keep weighted basis and a real unexplained withdrawal remains unknown',()=>{
 const actions=[{type:'BUY',symbol:'BELUSDT',qty:5,amountUsdt:15},{type:'BUY',symbol:'BELUSDT',qty:10,amountUsdt:20}];
 const p=liveBalancePnl({asset:'BEL',qty:15,usdtPrice:3,valueUsdt:45},actions);assert.equal(p.allocationIls,35);
 assert.equal(liveBalancePnl({asset:'BEL',qty:13,usdtPrice:3,valueUsdt:39},actions).pnlIls,null);
});
test('a floating-point-only wallet reconciliation preserves purchase cost and quote fees',()=>{
 const qty=136.7631,actual=136.76309999999998;
 const actions=[{type:'POSITION_RECONCILIATION',symbol:'TESTUSDT',qty:actual},{type:'BUY',symbol:'TESTUSDT',qty,amountUsdt:100,quoteFeeUsdt:.1}];
 const p=liveBalancePnl({asset:'TEST',qty:actual,usdtPrice:1,valueUsdt:actual},actions);
 assert.equal(p.allocationIls,100.1);assert.equal(p.entryPrice,100.1/qty);assert.equal(p.pnlIls,actual-100.1);
});
test('real reconciliations remain unknown even when followed by a floating-point-only adjustment',()=>{
 for(const reduction of [1e-8,.1,10]){
  const qty=100-reduction,actions=[{type:'POSITION_RECONCILIATION',symbol:'TESTUSDT',qty:qty-Number.EPSILON*qty},{type:'POSITION_RECONCILIATION',symbol:'TESTUSDT',qty},{type:'BUY',symbol:'TESTUSDT',qty:100,amountUsdt:200}];
  assert.equal(liveBalancePnl({asset:'TEST',qty,usdtPrice:3,valueUsdt:qty*3},actions).pnlIls,null);
 }
});
