// Observation only. No order client, credentials or account mutations.
export const POC_PAPER_POLICY = Object.freeze({version:'POC_PAPER_V1',lookback:50,pivotBars:2,profileRows:24,expiryMs:7200000,trailingPct:1,roundTripFeePct:0.1,quoteMaxAgeMs:10000,gapMs:15000,slots:{LONG:5,SHORT:2}});
const MINUTE=60000,FIVE=300000;
const validNumber=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));

export function minuteBars(raw,now){
 if(!Array.isArray(raw))throw Error('HISTORY_UNAVAILABLE');
 const rows=raw.map(r=>({at:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),end:Number(r[6])+1}));
 if(rows.some(r=>!Object.values(r).every(Number.isFinite)||r.at%MINUTE||r.end!==r.at+MINUTE||r.volume<0||r.low<=0||r.high<Math.max(r.open,r.close)||r.low>Math.min(r.open,r.close)))throw Error('HISTORY_INVALID');
 const closed=rows.filter(r=>r.end<=now);
 if(closed.some((r,i)=>i&&r.at<=closed[i-1].at))throw Error('HISTORY_INVALID');
 return closed;
}
export function volumePoc(rows,side){
 const low=Math.min(...rows.map(r=>r.low)),high=Math.max(...rows.map(r=>r.high)),width=(high-low)/24,volumes=Array(24).fill(0);
 if(!(width>0)||!rows.some(r=>r.volume>0))return null;
 for(const r of rows){
  if(r.high===r.low)volumes[Math.min(23,Math.max(0,Math.floor((r.low-low)/width)))]+=r.volume;
  else for(let k=0;k<24;k++)volumes[k]+=r.volume*Math.max(0,Math.min(low+(k+1)*width,r.high)-Math.max(low+k*width,r.low))/(r.high-r.low);
 }
 const max=Math.max(...volumes),ties=volumes.flatMap((v,k)=>Math.abs(v-max)<=1e-9+1e-10*Math.abs(max)?[k]:[]),k=side==='LONG'?ties.at(-1):ties[0];
 return low+(k+0.5)*width;
}
export function findPocSetup(raw,symbol,side,now){
 const minutes=minuteBars(raw,now),lastEnd=Math.floor(now/FIVE)*FIVE;
 const window=minutes.filter(r=>r.at>=lastEnd-50*FIVE&&r.end<=lastEnd);
 if(window.length!==250||window[0].at!==lastEnd-50*FIVE||window.at(-1).end!==lastEnd||window.some((r,i)=>i&&r.at!==window[i-1].end))throw Error('HISTORY_GAP');
 const bars=[];
 for(let i=0;i<250;i+=5){const m=window.slice(i,i+5);bars.push({at:m[0].at,end:m.at(-1).end,high:Math.max(...m.map(r=>r.high)),low:Math.min(...m.map(r=>r.low)),close:m.at(-1).close});}
 let seq=[],latest=null;
 for(let i=4;i<50;i++){
  const k=i-2,b=bars[k],neighbors=[k-2,k-1,k+1,k+2],high=neighbors.every(j=>b.high>bars[j].high),low=neighbors.every(j=>b.low<bars[j].low);
  if(high===low)continue;
  const p={i:k,at:b.at,kind:high?'H':'L',price:high?b.high:b.low};let changed=false;
  if(seq.at(-1)?.kind===p.kind){if(high?p.price>seq.at(-1).price:p.price<seq.at(-1).price){seq[seq.length-1]=p;changed=true;}}
  else {seq.push(p);changed=true;}
  if(!changed||seq.length<4)continue;
  const f=seq.slice(-4),kinds=f.map(p=>p.kind).join(''),direction=kinds==='LHLH'&&f[2].price>f[0].price&&f[3].price>f[1].price?'LONG':kinds==='HLHL'&&f[2].price<f[0].price&&f[3].price<f[1].price?'SHORT':null;
  if(direction!==side)continue;
  const poc=volumePoc(window.filter(r=>r.at>=f[2].at&&r.end<=bars[f[3].i].end),side);
  if(poc)latest={id:[symbol,side,...f.map(p=>p.at)].join(':'),symbol,side,poc,stop:f[2].price,confirmedAt:bars[i].end,expiresAt:bars[i].end+POC_PAPER_POLICY.expiryMs,historyAt:lastEnd};
 }
 if(!latest||latest.expiresAt<now)return null;
 // A setup invalidated after confirmation must not reappear on the next scan.
 const subsequent=bars.filter(b=>b.end>latest.confirmedAt);
 if(subsequent.some(b=>side==='LONG'?b.low<=latest.stop:b.high>=latest.stop))return null;
 return latest;
}

export function verifiedQuote(raw,now){
 if(!raw||![raw.bid,raw.ask,raw.at].every(validNumber))return null;
 const q={bid:Number(raw.bid),ask:Number(raw.ask),at:Number(raw.at)};
 return q.bid>0&&q.ask>=q.bid&&q.at<=now+1000&&now-q.at<=POC_PAPER_POLICY.quoteMaxAgeMs?q:null;
}
export function verifiedBalance(raw,now){
 if(!raw||raw.complete!==true||![raw.equity,raw.free,raw.at].every(validNumber))return null;
 const b={equity:Number(raw.equity),free:Number(raw.free),at:Number(raw.at)};
 return b.equity>=0&&b.free>=0&&b.at>0&&b.at<=now+1000&&now-b.at<=90000?b:null;
}
