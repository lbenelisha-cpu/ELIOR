import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../binance-agent.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function renderActivePositionProtection('),source.indexOf('\nfunction rotationGapText('));
function fixture(){
 const node=()=>({children:[],append(x){this.children.push(x);},prepend(x){this.children.unshift(x);}});
 const rows=[node(),node()],calls=[];
 const ctx={document:{createElement:node},$:()=>({children:rows}),LEVI_TRADE_RISK:{levels:p=>p?.exitPolicy?{}:null,render:(host,p,currency)=>calls.push({host,p,currency})}};
 vm.runInNewContext(code,ctx);return {rows,calls,render:ctx.renderActivePositionProtection};
}
test('LIVE matches each holding to its own protection and excludes stablecoins',()=>{
 const f=fixture();f.render({agents:[{symbol:'BNBUSDT',strategy:{exitPolicy:'managed',entryPrice:717,targetPrice:720},staleData:true}]},{balances:[{asset:'USDC',valueUsdt:30},{asset:'BNB',valueUsdt:700,qty:1,usdtPrice:718},{asset:'ETH',valueUsdt:100,qty:.1}]},true);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].p.entryPrice,717);assert.equal(f.calls[0].p.targetPrice,720);assert.equal(f.calls[0].p.currentPrice,718);
 assert.match(f.rows[0].children[0].children[0].textContent,/אינם עדכניים/);
 assert.match(f.rows[1].children[0].textContent,/אין נתוני הגנה/);
});
test('DEMO retains recorded protection when no scanner agent is available',()=>{
 const f=fixture();f.render({paper:{positions:{BNBUSDT:{symbol:'BNBUSDT',exitPolicy:'managed',entryPrice:717,qty:2,currentPrice:719}}}},null,false);
 assert.equal(f.calls[0].p.entryPrice,717);assert.equal(f.calls[0].p.qty,2);
});
