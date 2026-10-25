import {orderHasFill} from './order-has-fill.mjs';
// Counts actual fills; dust below the journal's threshold closes the trading position.
export function tradeCounts(actions,{dustThresholdUsdt=5}={}){
 const result={buys:0,sells:0,closed:0},positions=new Map(),seen=new Set();
 for(const a of [...(actions||[])].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))){
  if(a.type==='POSITION_RECONCILIATION'){
   if(a.qty===0||a.archiveAsDust)positions.delete(a.symbol);
   else if(Number.isFinite(a.qty)&&a.qty>0)positions.set(a.symbol,a.qty);
   continue;
  }
  if(!orderHasFill(a))continue;
  const key=a.orderId==null?null:a.symbol+':'+a.type+':'+a.orderId;if(key&&seen.has(key))continue;if(key)seen.add(key);
  if(a.type==='BUY'){result.buys++;positions.set(a.symbol,(positions.get(a.symbol)||0)+Number(a.qty));}
  else{result.sells++;const before=positions.get(a.symbol)||0;if(!before)continue;
   const remaining=Math.max(0,before-Number(a.qty));
   if(remaining<=1e-8||(Number(a.dustThresholdUsdt??dustThresholdUsdt)>0&&Number(a.price)>0&&remaining*Number(a.price)<Number(a.dustThresholdUsdt??dustThresholdUsdt))){result.closed++;positions.delete(a.symbol);}else positions.set(a.symbol,remaining);
  }
 }
 return result;
}

export function tradeFeeTotals(actions){
 const result={totalUsdt:0,buyUsdt:0,sellUsdt:0,unvalued:{},missingRecords:0},seen=new Set();
 for(const a of actions||[]){
  if(!orderHasFill(a))continue;
  const key=a.orderId==null?null:a.symbol+':'+a.type+':'+a.orderId;if(key&&seen.has(key))continue;if(key)seen.add(key);
  if(!Array.isArray(a.commissions)){result.missingRecords++;continue;}
  for(const f of a.commissions){
   const amount=Number(f.amount);if(!Number.isFinite(amount)||amount<0){result.missingRecords++;continue;}
   if(amount===0)continue;
   const base=String(a.symbol||'').endsWith('USDT')?a.symbol.slice(0,-4):null;
   const value=f.asset==='USDT'?amount:f.asset===base&&Number(a.price)>0?amount*Number(a.price):null;
   if(value===null){result.unvalued[f.asset||'UNKNOWN']=(result.unvalued[f.asset||'UNKNOWN']||0)+amount;continue;}
   result.totalUsdt+=value;result[a.type==='BUY'?'buyUsdt':'sellUsdt']+=value;
  }
 }
 result.complete=result.missingRecords===0&&Object.keys(result.unvalued).length===0;
 return result;
}
