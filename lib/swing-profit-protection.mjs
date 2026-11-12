// Entry-time snapshot. Two closed bars on each side confirm each pivot.
export const SWING_PROTECTION_VERSION='FIVE_CONFIRMED_SWINGS_V1';
export function swingProtection(bars,{side='LONG',timeframe='5m',at=Date.now()}={}){
 const base={version:SWING_PROTECTION_VERSION,side,timeframe,at,pivotBars:2,status:'FALLBACK',waves:[],reason:'INSUFFICIENT_CONFIRMED_WAVES'};
 const duration={'5m':300000,'1h':3600000,'1d':86400000}[timeframe];
 if(!duration||!['LONG','SHORT'].includes(side)||!Array.isArray(bars))return {...base,reason:'INVALID_HISTORY'};
 const rows=bars.filter(b=>b.closed!==false&&Number(b.closeTime)<=at);
 if(rows.some((b,i)=>!Number.isFinite(b.openTime)||!Number.isFinite(b.closeTime)||b.closeTime<=b.openTime||Math.abs(b.closeTime-b.openTime-duration)>1||!(b.low>0&&b.high>=b.low)||!Number.isFinite(b.high)||i&&b.openTime<=rows[i-1].openTime))return {...base,reason:'INVALID_HISTORY'};
 const pivots=[];
 for(let i=2;i<rows.length-2;i++){
  const b=rows[i],near=[rows[i-2],rows[i-1],rows[i+1],rows[i+2]];
  const high=near.every(n=>b.high>n.high),low=near.every(n=>b.low<n.low);
  if(high===low)continue; // An outside bar has no known intrabar ordering.
  const p={type:high?'HIGH':'LOW',price:high?b.high:b.low,time:b.openTime,confirmedAt:rows[i+2].closeTime};
  const last=pivots.at(-1);
  if(last?.type===p.type){if(high?p.price>last.price:p.price<last.price)pivots[pivots.length-1]=p;}
  else pivots.push(p);
 }
 const waves=[];
 for(let i=1;i<pivots.length;i++){
  const a=pivots[i-1],b=pivots[i];
  if(a.type!==(side==='LONG'?'LOW':'HIGH')||b.price===a.price)continue;
  const pct=(side==='LONG'?b.price-a.price:a.price-b.price)/a.price*100;
  if(pct>0&&Number.isFinite(pct))waves.push({from:a.time,to:b.time,fromPrice:a.price,toPrice:b.price,confirmedAt:b.confirmedAt,pct});
 }
 base.waves=waves.slice(-5);
 if(base.waves.length!==5)return base;
 const gapPct=base.waves.reduce((sum,w)=>sum+w.pct,0)/5;
 if(!(gapPct>0&&gapPct<100))return {...base,reason:'INVALID_AVERAGE'};
 return {...base,status:'ACTIVE',reason:null,gapPct};
}
export function frozenSwingGap(position){
 const p=position?.swingProtection||position?.setup?.swingProtection;
 return p?.version===SWING_PROTECTION_VERSION&&p.status==='ACTIVE'&&p.side===(position.side==='SHORT'?'SHORT':'LONG')&&p.waves?.length===5&&Number.isFinite(p.gapPct)&&p.gapPct>0&&p.gapPct<100?p.gapPct:null;
}
