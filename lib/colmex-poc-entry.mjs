// Colmex LONG POC reclaim. Structure and profile use the 50 closed 5m bars;
// the reclaim is checked against the live quote and current open 5m bar.
import {stockSessionGap} from './colmex-market-hours.mjs';
const STEP=300000,LOOKBACK=50,BINS=32;
const positive=n=>Number.isFinite(n)&&n>0;

export function colmexPocVolumePoint(bars,bins=BINS){
 if(!Array.isArray(bars)||!Number.isInteger(bins)||bins<2)return null;
 const rows=bars.filter(b=>[b.high,b.low,b.volume].every(Number.isFinite)&&b.high>=b.low&&b.volume>=0);
 if(!rows.length||!rows.some(b=>b.volume>0))return null;
 const low=Math.min(...rows.map(b=>b.low)),high=Math.max(...rows.map(b=>b.high)),step=(high-low)/bins;
 if(!(step>0))return null;
 const volume=Array(bins).fill(0);
 for(const b of rows){
  if(b.high===b.low){volume[Math.min(bins-1,Math.max(0,Math.floor((b.low-low)/step)))]+=b.volume;continue;}
  for(let i=0;i<bins;i++){
   const a=low+i*step,z=i===bins-1?high:a+step;
   volume[i]+=b.volume*Math.max(0,Math.min(z,b.high)-Math.max(a,b.low))/(b.high-b.low);
  }
 }
 const max=Math.max(...volume),index=volume.lastIndexOf(max);
 return {price:low+(index+.5)*step,low,high,bins,volumeAtPrice:max};
}

function confirmedPivots(bars){
 const sequence=[];
 for(let k=2;k<bars.length-2;k++){
  const b=bars[k],neighbors=[bars[k-2],bars[k-1],bars[k+1],bars[k+2]];
  const high=neighbors.every(n=>b.high>n.high),low=neighbors.every(n=>b.low<n.low);
  if(high===low)continue;
  const p={index:k,at:b.openTime,kind:high?'H':'L',price:high?b.high:b.low};
  const prior=sequence.at(-1);
  if(prior?.kind===p.kind){if(high?p.price>prior.price:p.price<prior.price)sequence[sequence.length-1]=p;}
  else sequence.push(p);
 }
 return sequence;
}

export function colmexPocSignal({bars,liveBar,price,priceAsOf,now=Date.now(),entryAfter=0,used=[],symbol=''}){
 const reject=(reason,details={})=>({ready:false,reason,phase:'POC_PRIMARY',...details});
 const quoteAt=typeof priceAsOf==='number'?priceAsOf:Date.parse(priceAsOf);
 if(!positive(price)||!Number.isFinite(quoteAt)||quoteAt>now||now-quoteAt>10000)return reject('WAIT_FRESH_PRICE');
 if(!Array.isArray(bars)||bars.length<LOOKBACK)return reject('WAIT_POC_HISTORY');
 const history=bars.slice(-LOOKBACK);
 if(history.some((b,i)=>!b||![b.openTime,b.closeTime,b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||b.closeTime!==b.openTime+STEP||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.volume<0||i&&b.closeTime-history[i-1].closeTime!==STEP&&!stockSessionGap(history[i-1].closeTime,b.closeTime)))return reject('GAPPED_POC_HISTORY');
 if(!liveBar||liveBar.openTime!==Math.floor(now/STEP)*STEP||![liveBar.open,liveBar.high,liveBar.low,liveBar.volume].every(Number.isFinite)||!positive(liveBar.open)||liveBar.high<Math.max(liveBar.open,price)||liveBar.low>Math.min(liveBar.open,price)||liveBar.volume<0)return reject('WAIT_POC_LIVE_BAR');
 if(history.at(-1).closeTime!==liveBar.openTime&&!stockSessionGap(history.at(-1).closeTime,liveBar.openTime+STEP))return reject('GAPPED_POC_HISTORY');
 const pivots=confirmedPivots(history),four=pivots.slice(-4);
 if(four.length<4||four.map(p=>p.kind).join('')!=='LHLH'||four[2].price<=four[0].price||four[3].price<=four[1].price)return reject('WAIT_POC_HIGHER_SWINGS');
 const profile=history.filter(b=>b.openTime>=four[2].at&&b.closeTime<=history[four[3].index].closeTime);
 const point=colmexPocVolumePoint(profile);
 if(!point)return reject('WAIT_POC_VOLUME_PROFILE',{pivots:four});
 const signalTime=liveBar.openTime,patternId=['poc',symbol,...four.map(p=>p.at)].join(':');
 const setup={entryMode:'poc_reclaim',policyVersion:'COLMEX_POC_RECLAIM_V1',patternId,signalTime,signalExpiresAt:signalTime+STEP,poc:point.price,pocRange:{low:point.low,high:point.high,bins:point.bins},structuralStop:four[2].price,pivots:four,phase:'POC_RECLAIM',buyConfirmed:true};
 if(signalTime<=entryAfter)return reject('WAIT_NEW_POC_SIGNAL',{setup});
 if(used.includes(patternId))return reject('POC_PATTERN_ALREADY_USED',{setup});
 if(history.slice(four[3].index+1).some(b=>b.low<=setup.structuralStop)||liveBar.low<=setup.structuralStop)return reject('POC_STRUCTURE_INVALIDATED',{setup});
 if(now<signalTime||now>=setup.signalExpiresAt)return reject('POC_SIGNAL_EXPIRED',{setup});
 // Intrabar reclaim: price is back above POC after trading at/below it in this bar.
 if(!(liveBar.low<=setup.poc&&price>setup.poc))return reject('WAIT_POC_RECLAIM',{setup});
 return {ready:true,reason:'POC_RECLAIM_READY',phase:setup.phase,setup,quality:{poc:setup.poc,lowTouches:four.filter(p=>p.kind==='L').length,highTouches:four.filter(p=>p.kind==='H').length}};
}

export function assertColmexPocEntry(setup,price,now,liveBar){
 if(setup?.entryMode!=='poc_reclaim'||setup.policyVersion!=='COLMEX_POC_RECLAIM_V1'||!positive(setup.poc)||!positive(setup.structuralStop)||!positive(setup.signalTime)||now<setup.signalTime||now>=setup.signalExpiresAt)throw Error('POC_SIGNAL_EXPIRED');
 if(!liveBar||liveBar.openTime!==Math.floor(now/STEP)*STEP||liveBar.closeTime!==liveBar.openTime+STEP||liveBar.closed!==false||!Number.isFinite(liveBar.receivedAt)||liveBar.receivedAt>now||now-liveBar.receivedAt>10000||![liveBar.open,liveBar.high,liveBar.low,liveBar.close,liveBar.volume].every(Number.isFinite)||!positive(liveBar.open)||!positive(liveBar.low)||liveBar.high<Math.max(liveBar.open,liveBar.close)||liveBar.low>Math.min(liveBar.open,liveBar.close)||liveBar.volume<0||liveBar.low>setup.poc||!positive(price)||price<=setup.poc)throw Error('WAIT_POC_RECLAIM');
 if(liveBar.low<=setup.structuralStop)throw Error('POC_STRUCTURE_INVALIDATED');
}
