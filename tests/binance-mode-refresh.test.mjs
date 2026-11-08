import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({});vm.runInContext(fs.readFileSync(new URL('../binance-mode-refresh.js',import.meta.url),'utf8'),ctx);
const create=ctx.LEVI_MODE_REFRESH.create;
test('status reads publish independently while slow account/chart work remains unresolved; overlapping reads are shared',async()=>{
 let finish,calls=0;const seen=[];
 const poll=create({context:()=> 'device',read:()=>{calls++;return new Promise(r=>finish=r);},publish:s=>seen.push(s)});
 const first=poll.refresh(),overlap=poll.refresh();assert.equal(first,overlap);await Promise.resolve();assert.equal(calls,1);
 finish({mode:'live',shortTrading:{checkedAt:123}});await first;assert.equal(seen.length,1);
 const next=poll.refresh();await Promise.resolve();assert.equal(calls,2);finish({mode:'live',shortTrading:{checkedAt:456}});await next;assert.equal(seen[1].shortTrading.checkedAt,456);
});
test('failed reads do not redate old data and the next refresh succeeds',async()=>{
 let calls=0;const seen=[];const poll=create({context:()=>'',publish:s=>seen.push(s),read:async()=>{if(++calls===1)throw Error('timeout');return {shortTrading:{checkedAt:7}};}});
 await assert.rejects(poll.refresh(),/timeout/);assert.equal(seen.length,0);await poll.refresh();assert.equal(seen[0].shortTrading.checkedAt,7);
});
test('disconnect/reconnect cannot publish an earlier device response or clear a newer in-flight request',async()=>{
 let key='old';const finish=[],seen=[];const poll=create({context:()=>key,publish:s=>seen.push(s),read:()=>new Promise(r=>finish.push(r))});
 const old=poll.refresh();await Promise.resolve();key='new';const current=poll.refresh();await Promise.resolve();
 finish[0]({private:'old'});await assert.rejects(old,/CONTEXT_CHANGED/);assert.equal(poll.refresh(),current);assert.equal(seen.length,0);
 finish[1]({private:'new'});await current;assert.equal(seen[0].private,'new');
});
