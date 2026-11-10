import test from 'node:test';import assert from 'node:assert/strict';
import {futuresTrendHistory} from '../lib/futures-trend-history.mjs';
test('hourly warm-up is cached, current candles are always fetched again, and readers remain isolated',async()=>{
 const at=Date.parse('2026-11-10T20:01Z'),calls=[];let tail=2;
 const reader=async(path,p)=>{calls.push(p.limit);return p.limit===1500?[[1],[2]]:[[tail],[tail+1]];};
 const first=await futuresTrendHistory(reader,'ABCUSDT',at);first[0][0]=-5;
 tail=3;assert.deepEqual(await futuresTrendHistory(reader,'ABCUSDT',at+1000),[[1],[2],[3],[4]]);
 assert.deepEqual(calls,[1500,206]);await futuresTrendHistory(reader,'ABCUSDT',at+3600000);assert.equal(calls.at(-1),1500);
 const fresh=async(p,q)=>{assert.equal(q.limit,1500);return [[8]];};assert.deepEqual(await futuresTrendHistory(fresh,'ABCUSDT',at),[[8]]);
});
test('failed or malformed fresh candle reads cannot fall back to cached quotes or authorize an entry',async()=>{
 let bad=false;const reader=async()=>bad?[[2],[1]]:[[1],[2]];
 await futuresTrendHistory(reader,'ABCUSDT',0);bad=true;
 await assert.rejects(futuresTrendHistory(reader,'ABCUSDT',1),/HISTORY_UNVERIFIED/);
});
