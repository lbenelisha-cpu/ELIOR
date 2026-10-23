import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8'),part=source.slice(source.indexOf('let lastDisplayAccount='),source.indexOf('async function getLiveAccountSnapshot(){'));
test('display reuses only a recent observation, while concurrent cold readers share one fresh request',async()=>{
 const at=1800000000000;let calls=0,resolve;const pending=new Promise(r=>resolve=r),context=vm.createContext({Date:class extends Date{static now(){return at;}},getLiveAccountSnapshot:()=>{calls++;return pending;}});vm.runInContext(part,context);
 vm.runInContext(`lastDisplayAccount={updatedAt:new Date(${at-1000}).toISOString(),test:'fresh'}`,context);assert.equal((await context.getDisplayAccountSnapshot()).test,'fresh');assert.equal(calls,0);
 vm.runInContext(`lastDisplayAccount={updatedAt:new Date(${at-10001}).toISOString(),test:'old'}`,context);const a=context.getDisplayAccountSnapshot(),b=context.getDisplayAccountSnapshot();assert.equal(calls,1);resolve({test:'new'});assert.equal((await a).test,'new');assert.equal((await b).test,'new');
});
