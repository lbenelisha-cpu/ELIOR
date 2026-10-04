export function sma(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a,b)=>a+b,0) / period;
}
const pct = (a,b) => Math.abs((b-a)/a)*100;
export function evaluateWaveStrategy(candles, opts={}) {
  const minWave=Number(opts.minWave??3), maxWave=Number(opts.maxWave??8), maPeriod=Number(opts.maPeriod??200), sellRetraceRatio=Number(opts.sellRetraceRatio??0.5);
  const closes=candles.map(c=>Number(c.close)).filter(Number.isFinite);
  if(closes.length<maPeriod+3) throw new Error(`Need at least ${maPeriod+3} closed candles`);
  let direction=null,waveStart=closes[0],extreme=closes[0],previousUpWave=null,previousDownWave=null,currentWave=0;
  for(let i=1;i<closes.length;i++){
    const p=closes[i],prev=closes[i-1];
    if(direction===null){if(p>prev)direction='UP';else if(p<prev)direction='DOWN';waveStart=prev;extreme=p;currentWave=pct(waveStart,extreme);continue;}
    if(direction==='UP'){
      if(p>=extreme){extreme=p;currentWave=pct(waveStart,extreme)}
      else{previousUpWave=pct(waveStart,extreme);direction='DOWN';waveStart=extreme;extreme=p;currentWave=pct(waveStart,extreme)}
    }else{
      if(p<=extreme){extreme=p;currentWave=pct(waveStart,extreme)}
      else{previousDownWave=pct(waveStart,extreme);direction='UP';waveStart=extreme;extreme=p;currentWave=pct(waveStart,extreme)}
    }
  }
  const price=closes.at(-1),ma=sma(closes,maPeriod),aboveMA=price>ma;
  const buyConfirmed=direction==='UP'&&previousDownWave!=null&&currentWave>=minWave&&currentWave<=maxWave&&currentWave>previousDownWave&&aboveMA;
  const sellThreshold=previousUpWave==null?null:previousUpWave*sellRetraceRatio;
  const sellConfirmed=direction==='DOWN'&&previousUpWave!=null&&currentWave>=sellThreshold;
  return {price,maPeriod,ma,aboveMA,direction,currentWave,previousUpWave,previousDownWave,minWave,maxWave,buyConfirmed,sellConfirmed,sellRetraceRatio,sellThreshold};
}
export function decidePosition(strategy,position='CASH'){
  if(position==='CASH'&&strategy.buyConfirmed)return 'BUY';
  if(position==='LONG'&&strategy.sellConfirmed)return 'SELL';
  return 'HOLD';
}
