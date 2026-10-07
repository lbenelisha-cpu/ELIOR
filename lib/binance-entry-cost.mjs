// Percent values use percentage points: 0.1 means 0.1%, never 10%.
export function assessEntryCost(book, amount, {
  feePct=0.1, bufferPct=0.1, maxSpreadPct=0.2, maxImpactPct=0.1,
  trailActivatePct=2, exitTrailPct=1, maxCostPctOverride=null
}={}) {
  const fail=(code,text,details={})=>({ok:false,code,text,...details});
  if(!Number.isFinite(amount)||amount<=0)return fail('WAIT_COST_DATA','ממתין לסכום קנייה תקין');
  if(![feePct,bufferPct,maxSpreadPct,maxImpactPct,trailActivatePct,exitTrailPct].every(x=>Number.isFinite(x)&&x>=0))return fail('WAIT_COST_DATA','הגדרות עלויות לא תקינות');
  if(maxCostPctOverride!==null&&(!Number.isFinite(maxCostPctOverride)||maxCostPctOverride<0))return fail('WAIT_COST_DATA','תקציב עלויות לא תקין');
  const parse=rows=>Array.isArray(rows)?rows.map(r=>r.map(Number)):[];
  const asks=parse(book?.asks),bids=parse(book?.bids);
  if(!asks.length||!bids.length||[...asks,...bids].some(r=>r.length!==2||!r.every(x=>Number.isFinite(x)&&x>0))||asks.some((r,i)=>i&&r[0]<asks[i-1][0])||bids.some((r,i)=>i&&r[0]>bids[i-1][0])||asks[0][0]<bids[0][0])return fail('WAIT_COST_DATA','ממתין לנתוני עומק תקינים');
  const spreadPct=(asks[0][0]/bids[0][0]-1)*100;
  let remaining=amount,qty=0;
  for(const [price,size] of asks){const spend=Math.min(remaining,price*size);qty+=spend/price;remaining-=spend;if(remaining<=amount*1e-10)break;}
  if(remaining>amount*1e-10)return fail('WAIT_LIQUIDITY','עומק הקנייה אינו מספיק לסכום העסקה');
  let remainingQty=qty,proceeds=0;
  for(const [price,size] of bids){const take=Math.min(remainingQty,size);proceeds+=take*price;remainingQty-=take;if(remainingQty<=qty*1e-10)break;}
  if(remainingQty>qty*1e-10)return fail('WAIT_LIQUIDITY','עומק המכירה אינו מספיק לכמות העסקה');
  const buyImpactPct=(amount/qty/asks[0][0]-1)*100;
  const sellImpactPct=(1-proceeds/qty/bids[0][0])*100;
  const estimatedCostPct=(1-proceeds/amount*(1-feePct/100)**2)*100+bufferPct;
  // Half of the gross margin retained at initial trailing activation is the cost budget.
  // This is an execution-cost budget, not a forecast of profit or guaranteed exit.
  const grossMarginPct=((1+trailActivatePct/100)*(1-exitTrailPct/100)-1)*100;
  const maxCostPct=maxCostPctOverride!==null
    ? Number(maxCostPctOverride)
    : Math.max(0,grossMarginPct/2);
  const details={spreadPct,buyImpactPct,sellImpactPct,estimatedCostPct,maxCostPct,amount,feePct,feeSource:'CONFIGURED_ESTIMATE'};
  if(spreadPct>maxSpreadPct)return fail('WAIT_SPREAD','מרווח קנייה ומכירה רחב: '+spreadPct.toFixed(3)+'%',details);
  if(Math.max(buyImpactPct,sellImpactPct)>maxImpactPct)return fail('WAIT_LIQUIDITY','השפעת סכום העסקה על המחיר גבוהה מדי',details);
  if(estimatedCostPct>maxCostPct)return fail('WAIT_COST','עלות משוערת '+estimatedCostPct.toFixed(3)+'% חורגת מתקציב '+maxCostPct.toFixed(3)+'%',details);
  return {ok:true,code:'COST_OK',text:'עלויות ועומק עברו בדיקה',...details};
}
