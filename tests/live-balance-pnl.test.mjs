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
