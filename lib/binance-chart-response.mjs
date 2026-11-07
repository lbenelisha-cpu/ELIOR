// Display-only projection at the website boundary. Never rewrite trading journals
// or the live agent snapshot: those still need their full execution evidence.
const rowFields=['at','firstAt','checks','mode','symbol','type','price','decision','reason','buyReason','analysisReason','analysisError','execution','analysisSignal','entryConfirmed','targetPrice'];
const setupFields=['version','time','timeframe','phase','patternId','signalTime','buyConfirmed','requireHigherRecovery'];
const pivotFields=['index','time','price','open','high','low','close','volume','live','spring'];
const pivots=['initialPeak','firstLow','rallyHigh','secondaryTest','secondRallyHigh','springLow','confirmation'];
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function scalars(value,fields){
 const out={};
 for(const key of fields){
  const v=value?.[key];
  if(v===null||['string','number','boolean'].includes(typeof v))out[key]=v;
 }
 return out;
}
function chartSetup(setup){
 if(!isObject(setup))return null;
 const out=scalars(setup,setupFields);
 for(const key of pivots)if(isObject(setup[key]))out[key]=scalars(setup[key],pivotFields);
 if(isObject(setup.recoveryComparison))out.recoveryComparison=scalars(setup.recoveryComparison,['passed','reason','firstRecovery','secondRecovery','difference','differencePct']);
 return out;
}
function chartRow(row){
 const out=scalars(row,rowFields);
 if(isObject(row.setup))out.setup=chartSetup(row.setup);
 if(isObject(row.wyckoffTrade?.setup))out.wyckoffTrade={setup:chartSetup(row.wyckoffTrade.setup)};
 return out;
}
export function compactChartResponse(data){
 if(!isObject(data)||data.ok!==true||!Array.isArray(data.candles))return data;
 const out={...data};
 for(const key of ['decisions','actions'])if(Array.isArray(data[key]))out[key]=data[key].filter(isObject).map(chartRow);
 return out;
}
