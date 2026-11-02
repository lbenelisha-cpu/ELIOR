import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spotPnlRows,reconcileShortPnl,readShortPnl} from '../lib/binance-trading-pnl.mjs';
import {createTradingPnlReader} from '../lib/binance-trading-pnl-reader.mjs';
import {patchTradingPnl} from '../scripts/patch-trading-pnl.mjs';
import {readTarget,createReadProxy} from '../netlify/functions/binance-read-proxy.mjs';
const at=Date.UTC(2026,10,2,12),close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const action=(type,orderId,qty,amountUsdt,extra={})=>({type,symbol:'TESTUSDT',orderId,qty,executedQty:qty,amountUsdt,price:amountUsdt/qty,commissions:[],status:'FILLED',at:new Date(at+orderId*1000).toISOString(),...extra});
test('LONG allocates entry fees across partial exits, deduplicates orders and retains dust cost',()=>{
 const buy=action('BUY',1,10,100,{commissions:[{asset:'USDT',amount:1}]}),first=action('SELL',2,9.8,107.8,{commissions:[{asset:'USDT',amount:.1}]}),second=action('SELL',4,.2,2.4);
 const rows=spotPnlRows([second,first,first,buy]);assert.equal(rows.length,2);close(rows[1].netPnlUsdt,8.72);assert.equal(rows[1].status,'PARTIAL');close(rows[0].netPnlUsdt,.38);assert.equal(rows[0].status,'CLOSED');close(rows[0].fees[0].amount,.02);
 assert.equal(JSON.stringify(buy.commissions),'[{"asset":"USDT","amount":1}]');
});
test('LONG base commission is counted through net quantity once; unknown fees or cost remain null',()=>{
 const buy=action('BUY',1,9.9,100,{executedQty:10,price:10,commissions:[{asset:'TEST',amount:.1}]});
 close(spotPnlRows([buy,action('SELL',2,9.9,108.9)])[0].netPnlUsdt,8.9);
 for(const altered of [{commissions:null},{commissions:[{asset:'BNB',amount:.01}]},{status:'ADOPTED'},{amountUsdt:null,amountIls:null}])assert.equal(spotPnlRows([{...buy,...altered},action('SELL',2,9.9,108.9)])[0].netPnlUsdt,null);
 assert.equal(spotPnlRows([action('SELL',2,1,20)])[0].issue,'MISSING_ENTRY_COST');
});
test('LONG real quantity reconciliation invalidates cost, zero P/L is known, external cash flows are excluded',()=>{
 const buy=action('BUY',1,10,100),sell=action('SELL',3,5,50);
 const rows=spotPnlRows([buy,{type:'TRANSFER',symbol:'TESTUSDT',at:new Date(at).toISOString(),amountUsdt:70},sell]);assert.equal(rows.length,1);assert.equal(rows[0].netPnlUsdt,0);
 const reconcile={type:'POSITION_RECONCILIATION',symbol:'TESTUSDT',qty:5,at:new Date(at+2000).toISOString()};assert.equal(spotPnlRows([buy,reconcile,sell])[0].netPnlUsdt,null);
 assert.equal(spotPnlRows([buy,{...buy,amountUsdt:90},sell])[0].netPnlUsdt,null);
});
function shortFixture(){
 const p={symbol:'TESTUSDT',entryOrderId:7,entryAt:at+20,closedAt:at+10000,qty:1000,entryPrice:.0250000,reason:'CHANNEL_TAKE_PROFIT'};
 const order={symbol:p.symbol,orderId:7,side:'SELL',positionSide:'BOTH',executedQty:'1000',cumQuote:'25.000003',time:at,status:'FILLED'};
 const trades=[{symbol:p.symbol,id:1,orderId:7,side:'SELL',positionSide:'BOTH',qty:'1000',quoteQty:'25.000003',realizedPnl:'0',commission:'.0125',commissionAsset:'USDT',time:at+1},{symbol:p.symbol,id:2,orderId:8,side:'BUY',positionSide:'BOTH',qty:'1000',quoteQty:'20.000002',realizedPnl:'5.000001',commission:'.01',commissionAsset:'USDT',time:at+9000}];
 const incomes=[{symbol:p.symbol,tranId:1,time:at+4000,incomeType:'FUNDING_FEE',asset:'USDT',income:'.005'},{symbol:p.symbol,tranId:2,time:at+4000,incomeType:'TRANSFER',asset:'USDT',income:'70'}];
 return {p,order,trades,incomes};
}
test('SHORT uses weighted actual fills, exit prices, commissions and signed funding; transfers never become P/L',()=>{
 const f=shortFixture(),r=reconcileShortPnl(f.p,f.order,[...f.trades,f.trades[0]],f.incomes);
 close(r.netPnlUsdt,4.982501);close(r.entryPrice,25.000003/1000);close(r.exitPrice,20.000002/1000);assert.equal(r.qty,1000);assert.equal(r.issue,null);
 const loss=structuredClone(f);loss.trades[1].quoteQty='30';loss.trades[1].realizedPnl='-4.999997';loss.incomes[0].income='-.01';assert.ok(reconcileShortPnl(loss.p,loss.order,loss.trades,loss.incomes).netPnlUsdt<0);
});
test('SHORT rejects unrelated orders, partial history, changed quantities and unvalued commissions',()=>{
 for(const mutate of [f=>f.order.side='BUY',f=>f.order.orderId=70,f=>f.trades.pop(),f=>f.trades[1].qty='999',f=>f.trades[0].orderId=100,f=>f.trades[1].positionSide='LONG',f=>f.trades[1].realizedPnl='99',f=>f.trades[0].commissionAsset='BNB',f=>f.incomes[0].asset='BNB',f=>f.trades.push({...f.trades[0],qty:'1'}),f=>f.trades.push({...f.trades[0],id:100,orderId:100,qty:'1'})]){
  const f=shortFixture();mutate(f);assert.equal(reconcileShortPnl(f.p,f.order,f.trades,f.incomes).netPnlUsdt,null);
 }
});
test('SHORT supports several partial closing fills and matches the full entry quantity',()=>{
 const f=shortFixture(),last=f.trades.pop();f.trades.push({...last,qty:'600',quoteQty:'12',realizedPnl:String(25.000003/1000*600-12),commission:'.006'},{...last,id:3,qty:'400',quoteQty:String(20.000002-12),realizedPnl:String(25.000003/1000*400-(20.000002-12)),commission:'.004',time:at+9500});
 close(reconcileShortPnl(f.p,f.order,f.trades,f.incomes).netPnlUsdt,4.982501);
});
test('SHORT reader only reads documented endpoints and respects exchange retention',async()=>{
 const f=shortFixture(),calls=[],get=async(route,params)=>{calls.push({route,params});return route.endsWith('/order')?f.order:route.endsWith('/userTrades')?f.trades:f.incomes.filter(r=>r.incomeType==='FUNDING_FEE');};
 close((await readShortPnl(f.p,get,at+60000)).netPnlUsdt,4.982501);
 assert.deepEqual(calls.map(c=>c.route),['/fapi/v1/order','/fapi/v1/userTrades','/fapi/v1/income']);assert.equal(calls[1].params.startTime,at);assert.equal(calls[2].params.incomeType,'FUNDING_FEE');
 await assert.rejects(readShortPnl(f.p,get,at+100*86400000),/EXCHANGE_HISTORY_EXPIRED/);assert.equal(calls.length,3);
});
test('full history pages are split without claiming completeness on truncation',async()=>{
 const f=shortFixture(),seen=[];
 const r=await readShortPnl(f.p,async(route,params)=>{
  if(route.endsWith('/order'))return f.order;
  seen.push(params);if(route.endsWith('/income'))return [];
  if(params.startTime===at&&params.endTime===f.p.closedAt)return Array.from({length:1000},(_,i)=>({...f.trades[0],id:i+10,time:at+1}));
  return f.trades.filter(t=>t.time>=params.startTime&&t.time<=params.endTime);
 },at+60000);
 assert.equal(r.issue,null);assert.ok(seen.some(p=>p.endTime===at+5000));assert.ok(seen.some(p=>p.startTime===at+5001));
});
test('report refresh is coalesced, persists only settled verified accounting and never writes a trading journal',async()=>{
 const f=shortFixture();let calls=0,saved,now=at+600000;
 const get=async(route)=>{calls++;return route.endsWith('/order')?f.order:route.endsWith('/userTrades')?f.trades:f.incomes;};
 const reader=createTradingPnlReader({get,now:()=>now,save:d=>saved=d});const source=JSON.stringify(f.p);
 const first=reader.read([], [f.p]);assert.equal(first.loadingShort,true);assert.equal(first.rows[0].netPnlUsdt,null);reader.read([], [f.p]);await reader.settled();assert.equal(calls,3);
 close(reader.read([], [f.p]).rows[0].netPnlUsdt,4.982501);assert.equal(JSON.stringify(f.p),source);assert.equal(saved.entries.length,1);
 const restarted=createTradingPnlReader({initial:saved,get:()=>{throw Error('must not fetch');},now:()=>now});assert.equal(restarted.read([], [f.p]).loadingShort,false);
 const health=restarted.read([], [f.p],{spotHealthy:false,shortHealthy:false});assert.equal(health.rows.length,0);assert.equal(health.issues.length,2);
});
test('exchange failure remains unknown and retries are bounded; cache write errors are explicit',async()=>{
 const f=shortFixture();let now=at+600000,calls=0;
 const reader=createTradingPnlReader({get:async()=>{calls++;throw Error('secret error detail');},now:()=>now});reader.read([], [f.p]);await reader.settled();const data=reader.read([], [f.p]);assert.equal(data.rows[0].issue,'EXCHANGE_HISTORY_UNAVAILABLE');assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(data),/secret/);
 now+=60001;reader.read([], [f.p]);await reader.settled();assert.equal(calls,2);
 const broken=createTradingPnlReader({get:async(route)=>route.endsWith('/order')?f.order:route.endsWith('/userTrades')?f.trades:f.incomes,now:()=>now,save:()=>{throw Error('disk');}});broken.read([], [f.p]);await broken.settled();assert.ok(broken.read([], [f.p]).issues.includes('PNL_CACHE_UNAVAILABLE'));
});
test('report proxy accepts only the private GET path and integration patch is atomic and idempotent',async()=>{
 assert.equal(readTarget('/api/binance-trading-pnl').pathname,'/api/binance-trading-pnl');assert.throws(()=>readTarget('/api/binance-trading-pnl?token=x'));
 const proxy=createReadProxy(()=>{throw Error('no write');});assert.equal((await proxy({httpMethod:'POST',queryStringParameters:{path:'/api/binance-trading-pnl'}})).statusCode,405);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'levi-pnl-'));
 try{
  const files=['server.mjs','binance-agent.js','binance-agent.html','lib/futures-short-api.mjs','netlify/functions/binance-read-proxy.mjs'];
  for(const file of files){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.copyFileSync(new URL('../'+file,import.meta.url),path.join(root,file));}
  const before=files.map(f=>fs.readFileSync(path.join(root,f),'utf8'));patchTradingPnl(root);patchTradingPnl(root);assert.deepEqual(files.map(f=>fs.readFileSync(path.join(root,f),'utf8')),before);
  const proxyFile=path.join(root,'netlify/functions/binance-read-proxy.mjs');
  fs.writeFileSync(proxyFile,before[4].replace("'/api/binance-trading-pnl',",'').replace("'/api/binance-trade-history',",''));
  patchTradingPnl(root);const patchedProxy=fs.readFileSync(proxyFile,'utf8');assert.match(patchedProxy,/const READ_PATHS=new Set\(\['\/api\/binance-trading-pnl',/);patchTradingPnl(root);assert.equal(fs.readFileSync(proxyFile,'utf8'),patchedProxy);
  fs.writeFileSync(path.join(root,'binance-agent.html'),'unknown');assert.throws(()=>patchTradingPnl(root),/UNRECOGNIZED/);assert.equal(fs.readFileSync(path.join(root,'server.mjs'),'utf8'),before[0]);
  const server=before[0];assert.ok(server.indexOf('if(protectedControl&&!authorized)')<server.indexOf("if(u.pathname==='/api/binance-trading-pnl'"));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
