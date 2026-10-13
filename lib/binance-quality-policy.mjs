export const QUALITY_POLICY=Object.freeze({minRangePct:1,minVolumeRatio:1,costCoverage:3,rsiMinDrop:2,rsiDeclines:2,atrPeriod:14,atrStopMultiplier:2,atrTrailMultiplier:1.5,minStopPct:.5,maxStopPct:2.5,minTrailPct:.5,maxTrailPct:4});
export const STABLE_BASES=new Set(['USDT','USDC','FDUSD','TUSD','USDP','DAI','BUSD','RLUSD','U','USD1','USDE','USDD','PYUSD','GUSD','FRAX','LUSD','SUSD']);
export function atr14(bars){
 const data=(bars||[]).filter(b=>b.closed!==false);if(data.length<15)return null;
 let atr=0;for(let i=1;i<data.length;i++){const high=Number(data[i].high),low=Number(data[i].low),prev=Number(data[i-1].close);if(![high,low,prev].every(v=>Number.isFinite(v)&&v>0)||high<low)return null;const tr=Math.max(high-low,Math.abs(high-prev),Math.abs(low-prev));atr=i<=14?atr+tr/14:(atr*13+tr)/14;}return atr;
}
export function atrPolicy(atr,price){
 if(!(atr>0)||!(price>0))return null;const pct=atr/price*100,p=QUALITY_POLICY;
 return {atrEnabled:true,atrValue:atr,atrStopPct:Math.max(p.minStopPct,Math.min(p.maxStopPct,pct*p.atrStopMultiplier)),atrTrailPct:Math.max(p.minTrailPct,Math.min(p.maxTrailPct,pct*p.atrTrailMultiplier))};
}
export function assessQualityEntry(symbol,bars,{estimatedCostPct=.3,now=Date.now()}={}){
 const fail=(code,details={})=>({ok:false,code,...details});
 if(STABLE_BASES.has(symbol.replace(/USDT$/,'')))return fail('WAIT_STABLECOIN');
 const data=(bars||[]).filter(b=>b.closed!==false&&Number(b.closeTime)<=now);if(data.length<600||now-Number(data.at(-1)?.closeTime)>300000)return fail('WAIT_QUALITY_DATA');
 const price=Number(data.at(-1).close),atr=atr14(data),recent=data.slice(-288);
 const rangePct=(Math.max(...recent.map(b=>Number(b.high)))-Math.min(...recent.map(b=>Number(b.low))))/price*100;
 const mean=a=>a.reduce((n,b)=>n+Number(b.volume),0)/a.length;
 const volumeRatio=mean(data.slice(-3))/mean(data.slice(-23,-3));
 const groups=new Map();for(const b of data){const key=Math.floor(Number(b.openTime??(Number(b.closeTime)-299999))/3600000);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(b);}
 const hours=[...groups.entries()].sort((a,b)=>a[0]-b[0]).filter(([key,rows])=>rows.length===12&&Number(rows[0].openTime??rows[0].closeTime-299999)===key*3600000&&rows.every((b,i)=>Number(b.closeTime)===key*3600000+(i+1)*300000-1)).map(([,rows])=>Number(rows.at(-1).close));
 if(hours.length<50||!(atr>0)||!Number.isFinite(rangePct)||!Number.isFinite(volumeRatio)||!Number.isFinite(estimatedCostPct)||estimatedCostPct<0)return fail('WAIT_QUALITY_DATA');
 const average=n=>hours.slice(-n).reduce((a,b)=>a+b,0)/n,sma20=average(20),sma50=average(50);
 const details={rangePct,volumeRatio,sma20,sma50,atr,estimatedCostPct,policy:atrPolicy(atr,price)};
 if(rangePct<Math.max(QUALITY_POLICY.minRangePct,estimatedCostPct*QUALITY_POLICY.costCoverage))return fail('WAIT_MOVEMENT',details);
 if(volumeRatio<QUALITY_POLICY.minVolumeRatio)return fail('WAIT_VOLUME',details);
 if(!(hours.at(-1)>sma20&&sma20>sma50))return fail('WAIT_HOURLY_TREND',details);
 return {ok:true,code:'QUALITY_CONFIRMED',...details};
}
