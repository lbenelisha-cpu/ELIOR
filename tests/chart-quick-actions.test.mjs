import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
function rows(){
 const listeners={},calls=[];
 const context=vm.createContext({
  URL,LEVI_QUICK_TRADING_PAGE:true,LEVI_QUICK_TRADE:(...args)=>calls.push(args),
  document:{querySelectorAll:()=>[],addEventListener:(type,fn)=>listeners[type]=fn,
   createElement:()=>({setAttribute(k,v){this[k]=v;}})}
 });
 vm.runInContext(read('tradingview-link.js'),context);
 vm.runInContext(read('asset-chart-link.js'),context);
 return {context,links:context.LEVI_ASSET_CHART,listeners,calls};
}
test('Binance row offers a single native broker link for its own instrument without an order callback',()=>{
 const {links,listeners,calls}=rows();
 for(const [market,ticker] of [['SPOT','BINANCE:AAOIBUSDT'],['FUTURES','BINANCE:AAOIUSDT.P']]){
  const markup=links.html('AAOIBUSDT',market);
  assert.equal((markup.match(/<a /g)||[]).length,1);
  assert.doesNotMatch(markup,/<button|onclick=/);
  const children=[],anchor=links.append({append:n=>children.push(n)},'AAOIBUSDT',market);
  assert.deepEqual(children,[anchor]);
  const url=new URL(anchor.href);
  assert.equal(url.searchParams.get('symbol'),ticker);assert.equal(url.searchParams.get('trade-now'),'BINANCE');
  assert.equal(anchor.target,'_blank');assert.match(anchor.rel,/noopener/);
  const event={target:{closest:s=>s==='a.asset-chart-link'?anchor:null},stopPropagation(){this.stopped=true;},preventDefault(){throw Error('native link was blocked');}};
  listeners.click(event);assert.equal(event.stopped,true);
 }
 assert.equal(links.html('<script>','SPOT'),'');assert.deepEqual(calls,[]);
});
test('stock rows keep their existing Colmex actions and non-trading views only open charts',()=>{
 const {context,links,listeners,calls}=rows();
 assert.match(links.html('AAPL','STOCK'),/מכירת LONG/);
 const button={dataset:{quickMarket:'STOCK',quickSide:'SELL',quickSymbol:'AAPL'}};
 listeners.click({target:{closest:s=>s.startsWith('button.')?button:null},stopPropagation(){},preventDefault(){}});
 assert.deepEqual(calls,[['SELL','AAPL','STOCK']]);
 delete context.LEVI_QUICK_TRADING_PAGE;
 assert.equal(links.actions('AAPL','STOCK'),'');
 assert.doesNotMatch(links.html('BTCUSDT'),/trade-now=|<button/);
});
