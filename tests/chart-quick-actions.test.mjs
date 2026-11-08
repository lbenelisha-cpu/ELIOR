import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
test('chart row actions label Futures separately, validate symbols and open only the clicked asset',()=>{
 const calls=[],listeners={},c=vm.createContext({LEVI_QUICK_TRADING_PAGE:true,LEVI_QUICK_TRADE:(...a)=>calls.push(a),document:{addEventListener:(type,fn)=>listeners[type]=fn}});
 vm.runInContext(fs.readFileSync(new URL('../asset-chart-link.js',import.meta.url),'utf8'),c);
 assert.match(c.LEVI_ASSET_CHART.html('HYPEUSDT','FUTURES'),/סגירת שורט/);assert.match(c.LEVI_ASSET_CHART.html('AAPL','STOCK'),/מכירת LONG/);assert.equal(c.LEVI_ASSET_CHART.actions('<script>','SPOT'),'');assert.equal(calls.length,0);const handler=c.LEVI_QUICK_TRADE;delete c.LEVI_QUICK_TRADE;assert.match(c.LEVI_ASSET_CHART.actions('AAPL','STOCK'),/קנייה/);c.LEVI_QUICK_TRADE=handler;
 const button={dataset:{quickSide:'SELL',quickSymbol:'HYPEUSDT',quickMarket:'FUTURES'}};
 listeners.click({target:{closest:()=>button},stopPropagation(){},preventDefault(){}});assert.deepEqual(calls,[['SELL','HYPEUSDT','FUTURES']]);
 delete c.LEVI_QUICK_TRADING_PAGE;assert.equal(c.LEVI_ASSET_CHART.actions('AAPL','STOCK'),'');
});
