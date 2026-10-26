// Observations only: no order, protection or strategy dependencies.
export const POSITION_ALPHA_VERSION='POSITION_ALPHA_5M_V1';
const STEP=300000, SCALE=.01;
const stamp=value=>typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
const positive=value=>Number.isFinite(Number(value))&&Number(value)>0;
const angle=rate=>Math.atan(rate/SCALE)*180/Math.PI;
export function positionAlphaReference(position){
 if(!position)return {status:'NO_POSITION'};
 if(!positive(position.entryPrice))return {status:'ENTRY_PRICE_UNAVAILABLE'};
 if(position.accountingAdjusted)return {status:'ENTRY_BASIS_CHANGED'};
 // Adoption time and the last purchase in an aggregated wallet are not the
 // start of that cost basis. Do not silently substitute either for entry.
 if(position.adoptedAt||position.adoptedExternal||position.entryMode==='manual_external')return {status:'ENTRY_TIME_UNVERIFIED'};
 const entryAt=stamp(position.alphaEntryAt??position.entryAt);
 if(!Number.isFinite(entryAt)||entryAt<=0)return {status:'ENTRY_TIME_UNVERIFIED'};
 const side=position.side??'LONG';
 if(!['LONG','SHORT'].includes(side))return {status:'INVALID_SIDE'};
 const entryPrice=Number(position.entryPrice),timeSource=position.alphaEntryAt?'BROKER_EXECUTION':'RECORDED_ENTRY';
 return {status:'READY',entryAt,entryPrice,side,timeSource,key:JSON.stringify([position.id??position.positionId??position.patternId??null,entryAt,entryPrice,side])};
}
export function analyzePositionAlpha(input,position,{now=Date.now()}={}){
 const reference=positionAlphaReference(position),base={version:POSITION_ALPHA_VERSION,status:reference.status,reference,capturedAt:now,asOf:null,fromEntry:null,recent:null,series:[],historyPartial:false};
 if(reference.status!=='READY')return base;
 if(!Number.isFinite(now)||reference.entryAt>now)return {...base,status:'INVALID_ENTRY_TIME'};
 try{
  if(!Array.isArray(input))throw Error();
  const series=[];let previous=-Infinity;
  for(const b of input){
   const openTime=b.openTime==null?stamp(b.date):Number(b.openTime),rawClose=b.closeTime==null?openTime+STEP:Number(b.closeTime);
   if(!Number.isFinite(openTime)||![STEP,STEP-1].includes(rawClose-openTime))throw Error();
   const at=openTime+STEP;
   if(b.closed===false||at>now)continue;
   if(openTime<=previous)throw Error();previous=openTime;
   if(openTime<reference.entryAt)continue; // exclude a candle containing pre-entry prices
   if(!['open','high','low','close'].every(k=>positive(b[k])))throw Error();
   const [o,h,l,c]=[b.open,b.high,b.low,b.close].map(Number);
   if(h<Math.max(o,c)||l>Math.min(o,c)||h<l)throw Error();
   const price=(h+l+c)/3;
   series.push({at,price,changePct:(price/reference.entryPrice-1)*100});
  }
  if(!series.length)return {...base,status:'WAIT_FIRST_CLOSE'};
  const last=series.at(-1),minutes=(last.at-reference.entryAt)/60000,rate=last.changePct/minutes;
  const recentPoints=series.slice(-5),continuous=recentPoints.length===5&&recentPoints.every((p,i)=>!i||p.at-recentPoints[i-1].at===STEP);
  let recent={status:'WAIT_WINDOW',samples:recentPoints.length,pctPerMinute:null,angle:null};
  if(continuous){
   const ys=recentPoints.map(p=>p.changePct),mean=ys.reduce((s,v)=>s+v,0)/5;
   // Five closes span 20 elapsed minutes; x = 0,5,10,15,20.
   const slope=ys.reduce((s,y,i)=>s+(i*5-10)*(y-mean),0)/250;
   recent={status:'READY',samples:5,minutes:20,pctPerMinute:slope,angle:angle(slope)};
  }
  return {...base,status:now-last.at>600000?'STALE':'READY',asOf:last.at,series,
   historyPartial:series[0].at!==Math.ceil(reference.entryAt/STEP)*STEP+STEP||series.some((p,i)=>i&&p.at-series[i-1].at!==STEP),
   fromEntry:{changePct:last.changePct,minutes,pctPerMinute:rate,angle:angle(rate)},recent};
 }catch{return {...base,status:'INVALID_DATA'};}
}
export function compactPositionAlpha(value){
 const {series,...snapshot}=value;return structuredClone(snapshot);
}
export function cachedPositionAlpha(snapshot,position,at){
 const reference=positionAlphaReference(position);
 if(reference.status!=='READY')return compactPositionAlpha(analyzePositionAlpha([],position,{now:at}));
 if(snapshot?.version!==POSITION_ALPHA_VERSION||snapshot.reference?.key!==reference.key||!(snapshot.capturedAt<=at)||snapshot.asOf>at)return compactPositionAlpha(analyzePositionAlpha([],position,{now:at}));
 const value=compactPositionAlpha(snapshot);
 if(value.status==='READY'&&at-value.asOf>600000)value.status='STALE';
 return value;
}
export function positionQuoteChange(reference,price,priceAt,now=Date.now()){
 const at=stamp(priceAt);
 if(reference?.status!=='READY'||!positive(price)||!Number.isFinite(at)||at>now||now-at>15000)return null;
 const priceChangePct=(Number(price)/reference.entryPrice-1)*100;
 return {price:Number(price),at,priceChangePct,grossPnlPct:priceChangePct*(reference.side==='SHORT'?-1:1)};
}
