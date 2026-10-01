import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
test('page renews expired session after service restart',async()=>{
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{append(){},replaceChildren(){},textContent:''});return elements.get(id)};let calls=[];
 const replies=[{session:'old'},null,{session:'new'},{connected:false,account:{type:'real'},receivedAt:new Date().toISOString()}];
 const fetch=async(url,options)=>{calls.push({url,token:options.headers?.['X-ELIOR-Session']});const i=calls.length-1;return {status:i===1?401:200,ok:i!==1,json:async()=>replies[i]}};
 vm.runInNewContext(await readFile(new URL('../mt4-panel.js',import.meta.url),'utf8'),{location:{origin:'http://127.0.0.1:22352'},document:{getElementById:get,createElement:()=>({}),querySelector:()=>({})},window:{dispatchEvent(){}},CustomEvent:class{},fetch,AbortSignal,Date,String,Error,setInterval(){}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,4);assert.equal(calls[3].token,'new');assert.match(get('status').textContent,/מנותק/);assert.equal(get('refresh').disabled,false);
});
