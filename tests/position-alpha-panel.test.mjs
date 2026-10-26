import test from 'node:test';import assert from 'node:assert/strict';
import {renderPositionAlpha} from '../position-alpha-panel.js';
const start=Date.UTC(2026,9,26,14),now=start+1500000;
const bars=[110,109,108,106,105].map((price,i)=>({openTime:start+i*300000,open:price,high:price,low:price,close:price}));
function element(tag){return {tag,children:[],textContent:'',dataset:{},attributes:{},events:{},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,fn){this.events[k]=fn;}};}
const text=n=>n.textContent+n.children.map(text).join(' ');
test('position display keeps the live P/L separate from two opposing alphas, is collapsed, and clears on a closed/replaced position',()=>{
 const prior=globalThis.document;globalThis.document={createElement:element,createElementNS:(_,tag)=>element(tag)};
 try{const host=element('section'),p={entryPrice:100,entryAt:start};
 renderPositionAlpha(host,bars,{symbol:'TESTUSDT',position:p,price:104,priceAt:now,now});assert.equal(host.children[0].open,undefined);assert.match(text(host),/\+5.00%/);assert.match(text(host),/\+4.00%/);assert.match(text(host),/↘/);assert.match(text(host),/↗/);
 const body=host.children[0].children[1],graph=body.children[2];assert.equal(graph.children[0].tag,'svg');
 renderPositionAlpha(host,bars,{symbol:'NEWUSDT',position:null,now});assert.equal(graph.children.length,0);assert.doesNotMatch(text(host),/\+5.00%|\+4.00%|TESTUSDT/);assert.match(text(host),/בחר פוזיציה פתוחה/);
 renderPositionAlpha(host,bars,{symbol:'TESTUSDT',position:p,price:104,priceAt:now,now:now+600001});assert.equal(host.dataset.status,'STALE');assert.match(text(host),/נתון עבר/);assert.doesNotMatch(text(host),/\+4.00%/);
 }finally{globalThis.document=prior;}
});
