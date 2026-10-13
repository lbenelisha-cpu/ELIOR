// Counts actual fills; dust below the journal's threshold closes the trading position.
export function tradeCounts(actions,{dustThresholdUsdt=5}={}){
 const result={buys:0,sells:0,closed:0},positions=new Map(),seen=new Set();
 for(const a of [...(actions||[])].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))){
  if(!['BUY','SELL'].includes(a.type)||!(Number(a.qty)>0)||a.status&& !['FILLED','PARTIALLY_FILLED'].includes(a.status))continue;
  const key=a.orderId==null?null:a.symbol+':'+a.type+':'+a.orderId;if(key&&seen.has(key))continue;if(key)seen.add(key);
  if(a.type==='BUY'){result.buys++;positions.set(a.symbol,(positions.get(a.symbol)||0)+Number(a.qty));}
  else{result.sells++;const before=positions.get(a.symbol)||0;if(!before)continue;
   const remaining=Math.max(0,before-Number(a.qty));
   if(remaining<=1e-8||(Number(a.dustThresholdUsdt??dustThresholdUsdt)>0&&Number(a.price)>0&&remaining*Number(a.price)<Number(a.dustThresholdUsdt??dustThresholdUsdt))){result.closed++;positions.delete(a.symbol);}else positions.set(a.symbol,remaining);
  }
 }
 return result;
}
