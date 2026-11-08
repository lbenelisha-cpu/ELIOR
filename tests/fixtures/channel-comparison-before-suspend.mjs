import '../regression-trend.js';
import '../parallel-channel.js';
const VERSION='CHANNEL_PAIRED_5M_100_30M_V1',D=300000;
const empty=()=>({errorSum:0,inside:0,widthSum:0,directionCorrect:0,directionCount:0});
export function observeChannels(state,{symbol,bars,at=Date.now()}){
 const s=state.channelComparison??={version:VERSION,startedAt:at,lastAt:at,pending:{},lastSample:{},resolved:0,expired:0,eligible:0,paired:0,regression:empty(),parallel:empty()};
 if(s.version!==VERSION)return;
 s.lastAt=at;
 const pending=s.pending[symbol];
 if(pending){
  const forward=bars.filter(b=>+b.openTime>pending.end&&+b.openTime<=pending.end+6*D&&+b.closeTime<=at&&b.closed!==false);
  if(forward.length===6&&forward.every((b,i)=>+b.openTime===pending.end+(i+1)*D&&Number.isFinite(+b.close)&&+b.close>0)){
   const price=+forward[5].close;
   for(const key of ['regression','parallel']){
    const model=pending[key],levels=globalThis.LEVI_REGRESSION.levels(model,pending.end+6*D),g=s[key];
    g.errorSum+=100*Math.abs(price-levels.middle)/pending.price;
    g.widthSum+=200*model.width/pending.price;
    g.inside+=price>=levels.lower&&price<=levels.upper?1:0;
    const predicted=Math.sign(levels.middle-pending.price),actual=Math.sign(price-pending.price);
    if(predicted&&actual){g.directionCount++;g.directionCorrect+=predicted===actual?1:0;}
   }
   s.resolved++;delete s.pending[symbol];
  }else if(at>pending.end+9*D){s.expired++;delete s.pending[symbol];}
 }
 if(s.pending[symbol]||Object.keys(s.pending).length>=300)return;
 const regression=globalThis.LEVI_REGRESSION.analyze(bars,{now:at,period:100,interval:'5m',deviations:2});
 if(!regression.ready||at-(regression.end+D)<0||at-(regression.end+D)>D||regression.end-(s.lastSample[symbol]??-Infinity)<6*D)return;
 s.lastSample[symbol]=regression.end;s.eligible++;
 const parallel=globalThis.LEVI_PARALLEL.analyze(bars,{now:at,period:100,interval:'5m',deviations:2});
 if(!parallel.ready)return;
 s.paired++;s.pending[symbol]={end:regression.end,price:regression.lastClose,regression,parallel};
 // Bounded universe history; active pending samples are retained separately.
 if(Object.keys(s.lastSample).length>1000){const oldest=Object.entries(s.lastSample).sort((a,b)=>a[1]-b[1]).slice(0,100);for(const [k] of oldest)delete s.lastSample[k];}
}
export function channelReport(state){
 const s=state.channelComparison;if(!s)return null;
 const report={version:s.version,startedAt:s.startedAt,lastAt:s.lastAt,resolved:s.resolved,expired:s.expired,pending:Object.keys(s.pending).length,paired:s.paired,eligible:s.eligible};
 for(const key of ['regression','parallel']){const g=s[key];report[key]={meanErrorPct:s.resolved?g.errorSum/s.resolved:null,containmentPct:s.resolved?100*g.inside/s.resolved:null,meanWidthPct:s.resolved?g.widthSum/s.resolved:null,directionPct:g.directionCount?100*g.directionCorrect/g.directionCount:null,directionCount:g.directionCount};}return report;
}
