import {orderHasFill} from './order-has-fill.mjs';

const number=v=>v!==null&&v!==undefined&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v));
const positive=v=>number(v)&&Number(v)>0;
const symbolOK=s=>typeof s==='string'&&/^[A-Z0-9]{2,24}USDT$/.test(s);
const millis=v=>typeof v==='number'?v:Date.parse(v);
const near=(a,b)=>Math.abs(a-b)<=Math.max(1e-10,Math.abs(b)*1e-8);
const sum=(rows,key)=>rows.reduce((n,r)=>n+Number(r[key]),0);
const scaled=(fees,f)=>fees.map(x=>({...x,amount:x.amount*f}));
function feesOf(a){
 const base=a.symbol.slice(0,-4),valid=Array.isArray(a.commissions)&&a.commissions.every(f=>typeof f.asset==='string'&&number(f.amount)&&Number(f.amount)>=0);
 const fees=valid?a.commissions.map(f=>({asset:f.asset,amount:Number(f.amount)})):[];
 return {fees,quote:fees.filter(f=>f.asset==='USDT').reduce((n,f)=>n+f.amount,0),known:valid&&fees.every(f=>f.amount===0||['USDT',base].includes(f.asset))};
}
function unknown(row,code){return {...row,netPnlUsdt:null,netPnlPct:null,issue:code};}

// Reporting only: replay recorded fills without touching the execution journal.
// Journal qty already includes base-asset commissions; never subtract them twice.
export function spotPnlRows(actions=[]){
 const inventory=new Map(),seen=new Map(),rows=[];
 const ordered=actions.filter(a=>symbolOK(a.symbol)&&Number.isFinite(millis(a.at))).slice().sort((a,b)=>millis(a.at)-millis(b.at));
 for(const a of ordered){
  let p=inventory.get(a.symbol);
  if(a.type==='POSITION_RECONCILIATION'){
   if(p&&number(a.qty)&&Number(a.qty)>=0&&!near(Number(a.qty),p.qty)){
    if(Number(a.qty)===0)inventory.delete(a.symbol);
    else {p.qty=Number(a.qty);p.known=false;}
   }
   continue;
  }
  if(!orderHasFill(a,{adopted:true}))continue;
  const key=a.orderId==null?null:a.symbol+':'+a.type+':'+a.orderId;
  const signature=JSON.stringify([a.qty,a.amountUsdt,a.amountIls,a.price,a.commissions,a.status]);
  if(key&&seen.has(key)){
   if(seen.get(key)!==signature){if(p)p.known=false;for(const r of rows)if(r.symbol===a.symbol)Object.assign(r,unknown(r,'CONFLICTING_RECORD'));}
   continue;
  }
  if(key)seen.set(key,signature);
  const qty=Number(a.qty),amount=Number(a.amountUsdt??a.amountIls),f=feesOf(a),at=millis(a.at);
  const valid=positive(a.amountUsdt??a.amountIls)&&positive(a.price);
  if(a.type==='BUY'){
   if(a.replaceWalletQuantity)p=null;
   const cost=valid?amount+f.quote:0;
   inventory.set(a.symbol,{qty:qty+(p?.qty||0),cost:cost+(p?.cost||0),entryAt:p?.entryAt||millis(a.sourcePurchaseAt||a.at),entryPrice:p?(p.entryPrice*p.qty+Number(a.price)*qty)/(p.qty+qty):Number(a.price),fees:[...(p?.fees||[]),...f.fees],known:valid&&f.known&&(p?.known??true)&&a.status!=='ADOPTED'});
   continue;
  }
  const row={id:'LONG:'+a.symbol+':'+(a.orderId??at),direction:'LONG',market:'SPOT',symbol:a.symbol,entryAt:p?.entryAt??null,closedAt:at,entryPrice:p?.entryPrice??null,exitPrice:positive(a.price)?Number(a.price):null,qty:positive(a.executedQty)?Number(a.executedQty):qty,reason:a.reason||null,source:'APP_FILL_JOURNAL',fundingUsdt:0,fees:f.fees,costUsdt:null,status:'UNKNOWN',netPnlUsdt:null,netPnlPct:null,issue:null};
  if(!p||qty>p.qty+Math.max(1e-10,p.qty*1e-8)){
   rows.push(unknown(row,'MISSING_ENTRY_COST'));inventory.delete(a.symbol);continue;
  }
  const ratio=Math.min(1,qty/p.qty),cost=p.cost*ratio,remaining=Math.max(0,p.qty-qty);
  row.fees=[...scaled(p.fees,ratio),...f.fees];row.costUsdt=p.known?cost:null;
  row.status=near(remaining,0)?'CLOSED':'PARTIAL';
  if(p.known&&valid&&f.known){row.netPnlUsdt=amount-f.quote-cost;row.netPnlPct=cost>0?row.netPnlUsdt/cost*100:null;}
  else row.issue='COST_OR_FEES_UNVERIFIED';
  rows.push(row);
  // Retain the cost of dust for a later sale or purchase; dust is not a realized loss.
  if(near(remaining,0))inventory.delete(a.symbol);
  else {p.qty=remaining;p.cost-=cost;p.fees=scaled(p.fees,1-ratio);}
 }
 return rows.sort((a,b)=>b.closedAt-a.closedAt);
}

export function shortPnlPlaceholder(p,issue='AWAITING_EXCHANGE_HISTORY'){
 return {id:'SHORT:'+p.symbol+':'+p.entryOrderId,direction:'SHORT',market:'FUTURES',symbol:p.symbol,entryAt:millis(p.entryAt),closedAt:millis(p.closedAt),entryPrice:positive(p.entryPrice)?Number(p.entryPrice):null,exitPrice:null,qty:null,reason:p.reason||null,source:'BINANCE_FUTURES_FILLS',fundingUsdt:null,fees:[],costUsdt:null,status:'CLOSED',netPnlUsdt:null,netPnlPct:null,issue};
}
function unique(rows,key){
 const map=new Map();
 for(const r of rows){const k=key(r);if(map.has(k)&&JSON.stringify(map.get(k))!==JSON.stringify(r))throw Error('CONFLICTING_EXCHANGE_HISTORY');map.set(k,r);}
 return [...map.values()];
}
// Match an entire flat-to-flat short by its owned entry order. Any extra SELL,
// mixed position side, missing close quantity or inconsistent realized P/L stays unknown.
export function reconcileShortPnl(p,order,trades,incomes){
 const base=shortPnlPlaceholder(p);
 const fail=code=>unknown(base,code);
 if(!symbolOK(p.symbol)||String(order?.orderId)!==String(p.entryOrderId)||order.symbol!==p.symbol||order.side!=='SELL'||order.positionSide!=='BOTH'||!positive(order.executedQty)||!positive(order.cumQuote)||!positive(order.time)||!['FILLED','EXPIRED','CANCELED'].includes(order.status))return fail('ENTRY_ORDER_UNVERIFIED');
 if(!Array.isArray(trades)||!Array.isArray(incomes))return fail('INVALID_EXCHANGE_HISTORY');
 let fills,flows;
 try{fills=unique(trades,t=>String(t.id));flows=unique(incomes,t=>t.incomeType+':'+t.tranId);}catch{return fail('CONFLICTING_EXCHANGE_HISTORY');}
 if(fills.some(t=>!number(t.id)||!number(t.orderId)||t.symbol!==p.symbol||t.positionSide!=='BOTH'||!['BUY','SELL'].includes(t.side)||!positive(t.time)||!positive(t.qty)||!positive(t.quoteQty)||!number(t.realizedPnl)||!number(t.commission)||Number(t.commission)<0||typeof t.commissionAsset!=='string'))return fail('INVALID_EXCHANGE_HISTORY');
 fills.sort((a,b)=>Number(a.time)-Number(b.time)||Number(a.id)-Number(b.id));
 const entries=fills.filter(t=>String(t.orderId)===String(p.entryOrderId)),exits=fills.filter(t=>t.side==='BUY');
 if(!entries.length||entries.some(t=>t.side!=='SELL'||Number(t.realizedPnl)!==0)||fills.some(t=>t.side==='SELL'&&String(t.orderId)!==String(p.entryOrderId)))return fail('AMBIGUOUS_POSITION_HISTORY');
 const qty=sum(entries,'qty'),quote=sum(entries,'quoteQty'),first=Number(entries[0].time);
 if(!near(qty,Number(order.executedQty))||!near(quote,Number(order.cumQuote))||!near(sum(exits,'qty'),qty)||!exits.length)return fail('INCOMPLETE_FILL_HISTORY');
 let exposure=0;
 for(const t of fills){exposure+=(t.side==='SELL'?1:-1)*Number(t.qty);if(exposure< -Math.max(1e-10,qty*1e-8))return fail('AMBIGUOUS_POSITION_HISTORY');}
 const last=Number(exits.at(-1).time),end=millis(p.closedAt);
 if(!Number.isFinite(end)||last>end||Number(exits[0].time)<first)return fail('AMBIGUOUS_POSITION_HISTORY');
 const gross=sum(exits,'realizedPnl'),calculated=quote-sum(exits,'quoteQty');
 // Exchange realized P/L is rounded per fill to eight decimals.
 if(Math.abs(gross-calculated)>Math.max(1e-7,fills.length*1e-8))return fail('REALIZED_PNL_MISMATCH');
 const fees=fills.map(t=>({asset:t.commissionAsset,amount:Number(t.commission)}));
 const funding=flows.filter(t=>t.incomeType==='FUNDING_FEE'&&Number(t.time)>=first&&Number(t.time)<=last);
 if(funding.some(t=>t.symbol!==p.symbol||!number(t.income)||!positive(t.time)||t.tranId==null))return fail('INVALID_FUNDING_HISTORY');
 const row={...base,entryAt:first,closedAt:last,entryPrice:quote/qty,exitPrice:sum(exits,'quoteQty')/qty,qty,costUsdt:quote,fees,grossPnlUsdt:gross,issue:null};
 if(fees.some(f=>f.amount!==0&&f.asset!=='USDT')||funding.some(f=>f.asset!=='USDT'))return unknown(row,'UNVALUED_FEE');
 row.fundingUsdt=sum(funding,'income');
 row.netPnlUsdt=gross-fees.reduce((n,f)=>n+f.amount,0)+row.fundingUsdt;
 row.netPnlPct=row.netPnlUsdt/quote*100;
 return row;
}

export async function readShortPnl(p,get,now=Date.now()){
 if(!symbolOK(p.symbol)||!positive(p.entryAt)||!positive(p.closedAt)||p.closedAt<p.entryAt)throw Error('INVALID_CLOSED_POSITION');
 // Conservative window inside Binance's three-month history retention.
 if(now-Number(p.entryAt)>85*86400000)throw Error('EXCHANGE_HISTORY_EXPIRED');
 const order=await get('/fapi/v1/order',{symbol:p.symbol,orderId:p.entryOrderId});
 if(!positive(order?.time))throw Error('ENTRY_ORDER_UNVERIFIED');
 const start=Number(order.time),end=Number(p.closedAt);
 if(start>end||now-start>85*86400000)throw Error('EXCHANGE_HISTORY_EXPIRED');
 let calls=0;
 async function readWindow(path,from,to){
  if(++calls>40)throw Error('HISTORY_LIMIT_REACHED');
  const batch=await get(path,{symbol:p.symbol,startTime:from,endTime:to,limit:1000,...(path.endsWith('/income')?{incomeType:'FUNDING_FEE'}:{})});
  if(!Array.isArray(batch)||batch.some(t=>!positive(t.time)||Number(t.time)<from||Number(t.time)>to||t.symbol!==p.symbol))throw Error('INVALID_EXCHANGE_HISTORY');
  if(batch.length<1000)return batch;
  if(from>=to)throw Error('HISTORY_LIMIT_REACHED');
  const middle=Math.floor((from+to)/2);
  return [...await readWindow(path,from,middle),...await readWindow(path,middle+1,to)];
 }
 const fills=[],funding=[];
 for(let from=start;from<=end;from+=7*86400000){
  const to=Math.min(end,from+7*86400000-1);
  fills.push(...await readWindow('/fapi/v1/userTrades',from,to));
  funding.push(...await readWindow('/fapi/v1/income',from,to));
 }
 return reconcileShortPnl(p,order,fills,funding);
}
