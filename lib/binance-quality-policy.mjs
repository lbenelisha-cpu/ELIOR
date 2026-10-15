export const ENTRY_POLICY_VERSION='WYCKOFF_5M_CONFIRMATION_GAIN80_STOP10_HOLD15_V3';
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
export function assessQualityEntry(symbol,bars,{now=Date.now()}={}){
 // Read-only diagnostics and execution share the current entry policy.
 // Fresh price, account funds and position limits are checked by the execution layer.
 if(STABLE_BASES.has(symbol.replace(/USDT$/,'')))return {ok:false,code:'WAIT_STABLECOIN'};
 const data=(bars||[]).filter(b=>b.closed!==false&&Number(b.closeTime)<=now);
 const price=Number(data.at(-1)?.close),atr=atr14(data);
 return {ok:true,code:'WYCKOFF_ENTRY_CONFIRMED',enabled:false,policy:atrPolicy(atr,price)};
}
