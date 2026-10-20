import test from 'node:test';import assert from 'node:assert/strict';
import {syncWatchRows} from '../lib/colmex-watch-view.mjs';
test('background quote updates retain row identity, scroll, focus and click behavior',()=>{
 const container={children:[],scrollTop:125,changes:0,replaceChildren(...children){this.children=children;this.changes++;}};
 const createElement=()=>({textContent:'',children:[],append(...children){this.children.push(...children);},setAttribute(k,v){this[k]=v;}});
 let selected=null,price='$10';const options={selected:'AAPL',createElement,onSelect:s=>{selected=s;},describe:()=>({text:price,title:'Provider'})};
 syncWatchRows(container,['AAPL','MSFT'],options);const row=container.children[1];price='$11';
 syncWatchRows(container,['AAPL','MSFT'],{...options,selected:'MSFT'});
 assert.equal(container.changes,1);assert.equal(container.children[1],row);assert.equal(container.scrollTop,125);assert.equal(row.children[1].textContent,'$11');assert.equal(row['aria-pressed'],'true');row.onclick();assert.equal(selected,'MSFT');
 syncWatchRows(container,['AAPL','MSFT','TSLA'],options);assert.equal(container.children.length,3);
});
