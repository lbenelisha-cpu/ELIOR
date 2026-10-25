import test from 'node:test';import assert from 'node:assert/strict';
import {balancedUniverse,isBstock} from '../lib/balanced-universe.mjs';
test('volume ranking retains separate quotas without classifying BNB as a stock',async()=>{
 assert.equal(isBstock('BNBUSDT'),false);assert.equal(isBstock('ARBUSDT'),false);assert.equal(isBstock('QQQBUSDT'),true);
 assert.deepEqual(await balancedUniverse(['BTCUSDT','ETHUSDT','SOLUSDT','TSLABUSDT','AAPLBUSDT','NVDABUSDT'],4,async()=>true),['BTCUSDT','ETHUSDT','TSLABUSDT','AAPLBUSDT']);
});
test('missing history, duplicate symbols and failures do not consume slots',async()=>{
 assert.deepEqual(await balancedUniverse(['BTCUSDT','BTCUSDT','ETHUSDT','SOLUSDT','TSLABUSDT','AAPLBUSDT','NVDABUSDT'],4,async s=>{if(s==='TSLABUSDT')throw Error();return s!=='BTCUSDT';}),['ETHUSDT','SOLUSDT','AAPLBUSDT','NVDABUSDT']);
});
test('shortfalls are not filled with the other class; odd sizes round down equally',async()=>{
 assert.deepEqual(await balancedUniverse(['BTCUSDT','ETHUSDT','SOLUSDT','TSLABUSDT'],5,async()=>true),['BTCUSDT','ETHUSDT','TSLABUSDT']);
});
