import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../binance-agent.js',import.meta.url),'utf8');
function setup(){
 const elements=new Map();const element=s=>{if(!elements.has(s))elements.set(s,{innerHTML:'',textContent:'',classList:{add(){},toggle(){}}});return elements.get(s);};
 const context={window:{LEVI_SCANNER_VIEW:{update:(body,rows)=>{body.innerHTML=rows.map(row=>`<tr class="${row.className}">${row.cells.map(cell=>`<td class="${cell.className||''}">${cell.html}</td>`).join('')}</tr>`).join('');}}},$:element,put:(s,v)=>element(s).textContent=v,fmt:(v,d=2)=>Number(v).toFixed(d),moneyUnit:'USDT',selectedSymbol:'ACEUSDT',activeView:'trade',currentVisibleAgents:[],document:{querySelectorAll:()=>[]},requestAnimationFrame(){},updateSelectedAsset(){}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function decisionLabel('),source.indexOf('function rotationGapText(')),context);
 return {context,elements,element};
}
function data(direction,pnl){return {paper:{currency:'USDT',positions:{ACEUSDT:{symbol:'ACEUSDT',entryPrice:1,allocationIls:100,qty:100,pnlIls:pnl,pnlPct:pnl}},activePositions:1,maxPositions:10},config:{},agents:[{symbol:'ACEUSDT',position:'LONG',decision:'ACTIVE_LONG',score:90,strategy:{price:1,direction},blocker:{text:'active'}}]};}
test('an UP trend with a losing position is red and labels trend separately',()=>{
 const x=setup();x.context.render(data('UP',-2));
 const html=x.element('#assetsBody').innerHTML;
 assert.match(html,/active-position pnl-loss/);assert.match(html,/הפסד לא ממומש/);assert.match(html,/מגמה: עולה/);assert.doesNotMatch(html,/active-up/);
 assert.match(x.element('#positions').innerHTML,/pnl-loss/);
});
test('a DOWN trend with a profitable position is green; no profit is guessed for missing cost data',()=>{
 const x=setup();x.context.render(data('DOWN',3));assert.match(x.element('#assetsBody').innerHTML,/active-position pnl-profit/);assert.match(x.element('#assetsBody').innerHTML,/מגמה: יורדת/);
 for(const pnl of [null,undefined,'',NaN])assert.equal(x.context.positionPnlDisplay({pnlIls:pnl}).kind,'unknown');
 assert.equal(x.context.positionPnlDisplay({pnlIls:0,pnlPct:0}).kind,'flat');
});
test('real-time portfolio colors the P/L cells using actual signed P/L',async()=>{
 const body={innerHTML:''};
 const context={window:{binanceReadUrl:u=>u},document:{querySelector:()=>body},setInterval(){},fetch:async()=>({json:async()=>({paper:{currency:'USDT',positions:{LOSS:{pnlIls:-1,pnlPct:-1},GAIN:{pnlIls:1,pnlPct:1},UNKNOWN:{pnlIls:null},ZERO:{pnlIls:0,pnlPct:0}}}})})};
 vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../binance-agent-portfolio.js',import.meta.url),'utf8'),context);
 await context.refreshPortfolioPositions();assert.match(body.innerHTML,/pnl-loss/);assert.match(body.innerHTML,/pnl-profit/);assert.match(body.innerHTML,/pnl-unknown/);assert.match(body.innerHTML,/pnl-flat/);
});

test('LIVE account sums open P/L and excludes USDT and dust without guessing missing costs',()=>{
 const x=setup();
 const balances=[{asset:'USDT',valueUsdt:25},{asset:'LINK',valueUsdt:29,pnlIls:0.38,allocationIls:28.62},{asset:'SUI',valueUsdt:29,pnlIls:0.25,allocationIls:28.75},{asset:'TRUMP',valueUsdt:28,pnlIls:-0.31,allocationIls:28.31},{asset:'U',valueUsdt:28,pnlIls:0,allocationIls:28},{asset:'DUST',valueUsdt:1,pnlIls:null}];
 assert.match(x.context.liveAccountPnlDisplay({balances}).text,/\+0.32 USDT/);
 assert.equal(x.context.liveAccountPnlDisplay({balances}).className,'pnl-profit');
 balances[1].pnlIls=null;
 assert.equal(x.context.liveAccountPnlDisplay({balances}).className,'pnl-unknown');
 assert.match(x.context.liveAccountPnlDisplay({balances}).text,/3\/4/);
 assert.equal(x.context.liveAccountPnlDisplay(null).className,'pnl-unknown');
});
