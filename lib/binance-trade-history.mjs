// Read-only Spot history. Never writes to the execution journal or places orders.
export function historySymbol(value){
 if(typeof value!=='string'||!/^([A-Z0-9]{2,24})USDT$/.test(value))throw Error('INVALID_HISTORY_SYMBOL');
 return value;
}
const numeric=(v,zero=false)=>v!==null&&v!==undefined&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v))&&(zero?Number(v)>=0:Number(v)>0);
const id=v=>{if((typeof v==='number'&&!Number.isSafeInteger(v))||!/^\d+$/.test(String(v)))throw Error('INVALID_TRADE_ID');return String(v);};
export function buildTradeHistory(symbol,trades,actions=[]){
 historySymbol(symbol);if(!Array.isArray(trades))throw Error('INVALID_TRADE_HISTORY');
 const seen=new Map(),base=symbol.slice(0,-4),orders=new Map(),reasons=new Map();
 for(const a of actions)if(a.symbol===symbol&&['BUY','SELL'].includes(a.type)&&a.orderId!=null&&a.reason)reasons.set(a.type+':'+String(a.orderId),String(a.reason));
 for(const t of trades){
  if(t.symbol!==symbol||typeof t.isBuyer!=='boolean'||!numeric(t.qty)||!numeric(t.quoteQty)||!numeric(t.price)||!numeric(t.commission,true)||!numeric(t.time)||!Number.isFinite(new Date(Number(t.time)).getTime())||typeof t.commissionAsset!=='string')throw Error('INVALID_TRADE_HISTORY');
  const key=id(t.id),orderId=id(t.orderId),row={id:key,orderId,time:Number(t.time),side:t.isBuyer?'BUY':'SELL',qty:Number(t.qty),quote:Number(t.quoteQty),fee:Number(t.commission),feeAsset:t.commissionAsset};
  if(seen.has(key)&&JSON.stringify(seen.get(key))!==JSON.stringify(row))throw Error('CONFLICTING_TRADE_ID');
  seen.set(key,row);
 }
 const fills=[...seen.values()].sort((a,b)=>a.time-b.time||(BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0));
 let qty=0,cost=0,knownFees=true,entryAt=null;
 for(const f of fills){
  const key=f.side+':'+f.orderId,at=new Date(f.time).toISOString(),baseFee=f.feeAsset===base?f.fee:0,quoteFee=f.feeAsset==='USDT'?f.fee:0,feesKnown=f.fee===0||[base,'USDT'].includes(f.feeAsset);
  let row=orders.get(key);
  if(!row){row={symbol,orderId:f.orderId,side:f.side,at,firstAt:at,qty:0,quoteQty:0,commissions:{},fillCount:0,entryAt:null,allocatedCostUsdt:0,disposedQty:0,netPnlUsdt:0,pnlBeforeOtherFeesUsdt:0,costKnown:true,feesKnown:true,reason:reasons.get(key)||null};orders.set(key,row);}
  row.at=at;row.qty+=f.qty;row.quoteQty+=f.quote;row.fillCount++;row.commissions[f.feeAsset]=(row.commissions[f.feeAsset]||0)+f.fee;
  if(f.side==='BUY'){
   const received=f.qty-baseFee;if(!(received>0))throw Error('INVALID_BASE_FEE');
   if(qty===0)entryAt=at;qty+=received;cost+=f.quote+quoteFee;knownFees=knownFees&&feesKnown;
   row.status='BOUGHT';continue;
  }
  const consumed=f.qty+baseFee,noise=Number.EPSILON*Math.max(1,qty,consumed)*8;
  const matched=qty>0&&consumed<=qty+noise,allocated=matched?cost*Math.min(1,consumed/qty):null;
  row.entryAt=row.entryAt||entryAt;row.disposedQty+=consumed;
  if(matched){row.allocatedCostUsdt+=allocated;row.pnlBeforeOtherFeesUsdt+=f.quote-quoteFee-allocated;}
  row.costKnown=row.costKnown&&matched;row.feesKnown=row.feesKnown&&knownFees&&feesKnown;
  const remaining=Math.max(0,qty-consumed);
  if(remaining<=noise){qty=0;cost=0;entryAt=null;knownFees=true;}
  else{cost*=remaining/qty;qty=remaining;}
  row.status=!row.costKnown?'UNKNOWN':qty===0?'CLOSED':qty*(f.quote/f.qty)<5?'DUST':'PARTIAL';
 }
 const rows=[...orders.values()].map(row=>{
  const sale=row.side==='SELL',known=sale&&row.costKnown&&row.feesKnown;
  return {...row,price:row.quoteQty/row.qty,commissions:Object.entries(row.commissions).filter(([,amount])=>amount>0).map(([asset,amount])=>({asset,amount})),entryPrice:sale&&row.costKnown?row.allocatedCostUsdt/row.disposedQty:null,
   netPnlUsdt:known?row.pnlBeforeOtherFeesUsdt:null,netPnlPct:known&&row.allocatedCostUsdt>0?row.pnlBeforeOtherFeesUsdt/row.allocatedCostUsdt*100:null,
   pnlBeforeOtherFeesUsdt:sale&&row.costKnown?row.pnlBeforeOtherFeesUsdt:null,
   unknownReason:!sale?null:!row.costKnown?'MISSING_BUY':!row.feesKnown?'UNVALUED_FEE':null};
 }).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
 const sales=rows.filter(r=>r.side==='SELL'),valued=sales.filter(r=>r.netPnlUsdt!==null);
 return {symbol,source:'BINANCE_MY_TRADES',rows,fillCount:fills.length,summary:{buys:rows.length-sales.length,sells:sales.length,valuedSales:valued.length,unknownSales:sales.length-valued.length,netPnlUsdt:valued.length?valued.reduce((n,r)=>n+r.netPnlUsdt,0):null}};
}

export function createTradeHistoryReader({fetchTrades,now=Date.now,ttlMs=60000,pageSize=1000,maxPages=5,maxPending=2}){
 const cache=new Map(),pending=new Map();
 async function read(symbol,actions=[]){
  historySymbol(symbol);let saved=cache.get(symbol);
  if(!saved||now()-saved.at>=ttlMs){
   if(!pending.has(symbol)){
    if(pending.size>=maxPending)throw Error('HISTORY_BUSY');
    const task=(async()=>{
     const fills=[];let fromId='0',complete=false;
     for(let page=0;page<maxPages;page++){
      const batch=await fetchTrades(symbol,{fromId,limit:pageSize});
      // Validate before using IDs for pagination; no partial results on failure.
      buildTradeHistory(symbol,batch);
      if(batch.some(t=>BigInt(id(t.id))<BigInt(fromId)))throw Error('HISTORY_PAGINATION_INVALID');
      fills.push(...batch);
      if(batch.length<pageSize){complete=true;break;}
      fromId=(batch.reduce((n,t)=>BigInt(id(t.id))>n?BigInt(id(t.id)):n,BigInt(fromId))+1n).toString();
     }
     const value={at:now(),fills,complete};cache.set(symbol,value);
     if(cache.size>16)cache.delete(cache.keys().next().value);return value;
    })();pending.set(symbol,task);
    task.finally(()=>pending.delete(symbol)).catch(()=>{});
   }
   saved=await pending.get(symbol);
  }
  return {...buildTradeHistory(symbol,saved.fills,actions),complete:saved.complete,asOf:new Date(saved.at).toISOString()};
 }
 return {read};
}
