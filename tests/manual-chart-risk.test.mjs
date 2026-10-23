import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('manual holding risk is display only, updates P/L and never implies bot ownership',()=>{
 const nodes=[];const document={createElement(tag){const n={tag,children:[],textContent:'',append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},setAttribute(){}};nodes.push(n);return n;}};
 const ctx={document};vm.runInNewContext(fs.readFileSync(new URL('../trade-risk.js',import.meta.url),'utf8'),ctx);
 const api=ctx.LEVI_TRADE_RISK,host=document.createElement('div'),p={entryPrice:100,qty:2,currentPrice:99.5,pnlIls:-1,displayOnly:true};
 api.render(host,p,'USDT');assert.equal(host.hidden,false);assert.equal(api.levels(p).pnl,-1);
 const allText=()=>nodes.map(n=>n.textContent).join('|');assert.match(allText(),/החזקה ידנית/);assert.match(allText(),/רווח \/ הפסד כעת/);assert.match(allText(),/ללא ניהול אוטומטי/);assert.match(allText(),/המחשה/);
 const count=nodes.length;api.render(host,p,'USDT');assert.equal(nodes.length,count);api.render(host,{...p,pnlIls:1},'USDT');assert.ok(nodes.length>count);
 assert.equal(p.exitPolicy,undefined);assert.equal(api.levels({entryPrice:100,qty:2}),null);
 api.render(host,null,'USDT');assert.equal(host.hidden,true);
});
