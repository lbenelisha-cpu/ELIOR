// GET-only incident report. Run from the deployed application's directory.
// Does not mutate journals, settings, exchange orders or service state.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const pick=(x,keys)=>Object.fromEntries(keys.map(k=>[k,x?.[k]]));
const show=(name,data)=>console.log(name,JSON.stringify(data));
try {
 const symbol=process.argv[2];
 if(!/^[A-Z0-9]{2,25}USDT$/.test(symbol||''))throw Error('INVALID_SYMBOL');
 const pid=execFileSync('systemctl',['show','levi-binance','-p','MainPID','--value'],{encoding:'utf8'}).trim();
 if(!/^[1-9]\d*$/.test(pid))throw Error('SERVICE_NOT_RUNNING');
 const entries=fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0');
 const value=n=>entries.find(x=>x.startsWith(n+'='))?.slice(n.length+1).trim();
 const file=value('BINANCE_FUTURES_SHORT_FILE')||(value('BINANCE_LIVE_LOG_FILE')||'/var/data/binance-live-actions.json')+'.futures-short';
 const s=JSON.parse(fs.readFileSync(file,'utf8')),p=s.positions?.[symbol]||s.closed?.findLast(x=>x.symbol===symbol);
 const {FuturesShortAPI}=await import(pathToFileURL(path.resolve('lib/futures-short-api.mjs')));
 const api=new FuturesShortAPI({key:value('BINANCE_API_KEY'),secret:value('BINANCE_API_SECRET')});
 show('READ_ONLY',{at:new Date().toISOString(),halt:s.halt,pending:!!s.pending});
 show('JOURNAL',pick(p,['symbol','qty','entryPrice','entryAt','entryOrderId','targetPrice','stopPrice','protectedAt','algos','reason','closedAt','currentPrice']));
 const a=await api.get('/fapi/v2/account');
 show('EXCHANGE',a.positions.filter(x=>x.symbol===symbol).map(x=>pick(x,['symbol','positionSide','positionAmt','entryPrice','isolated','leverage','updateTime'])));
 if(p?.entryOrderId){
  const o=await api.get('/fapi/v1/order',{symbol,orderId:p.entryOrderId});
  show('ENTRY',pick(o,['symbol','orderId','clientOrderId','status','side','positionSide','executedQty','avgPrice','cumQuote','updateTime']));
 }
 const mode=await api.get('/fapi/v1/positionSide/dual');
 show('MODE',{hedgeMode:mode.dualSidePosition,multiAssetsMargin:a.multiAssetsMargin});
 const orders=await api.get('/fapi/v1/openOrders',{symbol});
 show('OPEN_ORDERS',orders.map(o=>pick(o,['orderId','symbol','side','type','status','origQty','executedQty','reduceOnly'])));
 const algos=await api.get('/fapi/v1/openAlgoOrders',{symbol});
 show('OPEN_ALGOS',algos.map(o=>pick(o,['algoId','clientAlgoId','symbol','orderType','algoStatus','side','positionSide','closePosition','triggerPrice','actualOrderId'])));
 for(const ref of p?.algos||[]){
  try{
   const o=await api.get('/fapi/v1/algoOrder',ref.algoId?{algoId:ref.algoId}:{clientAlgoId:ref.clientAlgoId});
   show('OWN_ALGO',pick(o,['algoId','clientAlgoId','symbol','orderType','algoStatus','side','positionSide','closePosition','triggerPrice','actualOrderId']));
  }catch(e){show('OWN_ALGO_ERROR',{kind:ref.kind,error:/^FUTURES_[A-Z0-9_-]+$/.test(e.message)?e.message:'READ_FAILED'});}
 }
 if(p?.entryAt){
  const rows=await api.get('/fapi/v1/income',{symbol,startTime:p.entryAt-5000,endTime:Date.now(),limit:100});
  const relevant=rows.filter(x=>x.symbol===symbol&&['REALIZED_PNL','COMMISSION','FUNDING_FEE'].includes(x.incomeType));
  show('INCOME',{complete:rows.length<100,rows:relevant.map(x=>pick(x,['incomeType','income','asset','time','tradeId']))});
 }
 show('COMPLETE',{readOnly:true,ordersSubmitted:0});
}catch(e){
 show('CHECK_FAILED',{error:/^[A-Z0-9_-]+$/.test(e?.message||'')?e.message:'READ_CHECK_FAILED'});
 process.exitCode=1;
}
