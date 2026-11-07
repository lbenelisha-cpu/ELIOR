/* Read-only display of independent server checks; legacy ordered results remain labelled. Never authorizes a trade. */
(function(root){
 const STEP=300000;
 const transient=new Set(['WAIT_FRESH_PRICE','WAIT_FRESH_FUTURES_PRICE','WAIT_CHANNEL_LIVE_BAR','WAIT_FUTURES_LIVE_BAR','WAIT_CHANNEL_HISTORY','WAIT_FUTURES_HISTORY','GAPPED_CHANNEL_HISTORY','GAPPED_FUTURES_HISTORY']);
 // A recorded rejection proves only the gates reached before it. Later gates
 // remain unknown, even when a different (closed-bar) observer looks favorable.
 const long=[
  ['quote',['WAIT_FRESH_PRICE']],['bar',['WAIT_CHANNEL_LIVE_BAR']],
  ['new',['WAIT_NEW_CHANNEL_SIGNAL']],
  ['history',['INVALID_CHANNEL_HISTORY','WAIT_CHANNEL_HISTORY','GAPPED_CHANNEL_HISTORY']],
  ['channel',['WAIT_CHANNEL_PIVOTS','WAIT_CHANNEL_TWO_TOUCHES']],
  ['slope',['REGRESSION_DIRECTION_BLOCK']],['break',['WAIT_CHANNEL_LIVE_BREAKOUT']],
  ['center',['REGRESSION_CENTER_BLOCK']],['volumeData',['WAIT_VOLUME_HISTORY']],
  ['volume',['CHANNEL_VOLUME_LOW']],['liquidity',['CHANNEL_LIQUIDITY_LOW']],
  ['unused',['CHANNEL_PATTERN_ALREADY_USED']],
  ['range',['WAIT_CHANNEL_CONSOLIDATION','INVALID_CHANNEL_CONSOLIDATION','CHANNEL_CONSOLIDATION_SIDE_BLOCK']],
  ['rangeBreak',['WAIT_CHANNEL_CONSOLIDATION_BREAK']],['atr',['WAIT_ATR_HISTORY']],
  ['plan',['INVALID_CHANNEL_PROTECTION','CHANNEL_TARGET_ALREADY_REACHED']]
 ];
 const short=[
  ['quote',['WAIT_FRESH_FUTURES_PRICE']],['bar',['WAIT_FUTURES_LIVE_BAR']],
  ['history',['INVALID_FUTURES_HISTORY','WAIT_FUTURES_HISTORY','GAPPED_FUTURES_HISTORY']],
  ['new',['WAIT_NEW_SHORT_SIGNAL']],['channel',['WAIT_TWO_TOUCHES_PER_SIDE']],
  ['slope',['SHORT_REGRESSION_DIRECTION_BLOCK']],['break',['WAIT_LOWER_CHANNEL_LIVE_BREAK']],
  ['center',['SHORT_REGRESSION_CENTER_BLOCK']],['volumeData',['WAIT_VOLUME_HISTORY']],
  ['volume',['SHORT_VOLUME_LOW']],['liquidity',['SHORT_LIQUIDITY_LOW']],
  ['price',['SHORT_PRICE_INVALIDATED']],['plan',['SHORT_TARGET_ALREADY_REACHED']],
  ['unused',['SHORT_PATTERN_ALREADY_USED']],
  ['range',['WAIT_CHANNEL_CONSOLIDATION','INVALID_CHANNEL_CONSOLIDATION','CHANNEL_CONSOLIDATION_SIDE_BLOCK']],
  ['rangeBreak',['WAIT_CHANNEL_CONSOLIDATION_BREAK']]
 ];
 function project({side,reason,at,now=Date.now(),expiresAt,transport=false,supported=false,blocker=null,conditions=null,schemaVersion=null}={}){
  const sell=side==='SHORT',stages=sell?short:long;
  // Policy selects the labels even when a scan/report is unavailable. Labels
  // are not evidence: POC checks can pass only from a valid matching report.
  const reportVersion=schemaVersion??conditions?.version;
  const pocPolicy=reportVersion==='CHANNEL_POC_CONDITIONS_V1';
  const definitions=pocPolicy?[
   ['channel','1 · תעלה מאושרת · 2 נגיעות בכל גבול',['channel']],
   ['break',sell?'3 · שבירה מתחת לתעלה וקיבוע הטווח':'3 · פריצה מעל התעלה וקיבוע הטווח',['break']],
   ['poc',sell?'4 · חזרה מלמטה אל POC':'4 · חזרה מלמעלה אל POC',['poc']],
   ['range',sell?'8 · דשדוש בתחילת התעלה · עליון או אמצעי':'8 · דשדוש בתחילת התעלה · תחתון או אמצעי',['range']]
  ]:[
   ['channel','תעלה מאושרת · 2 נגיעות בכל גבול',['channel']],
   ['slope',sell?'רגרסיה יורדת':'רגרסיה עולה',['slope']],
   ['break',sell?'שבירה חדשה מתחת לגבול התחתון':'פריצה חדשה מעל הגבול העליון',['break']],
   ['center',sell?'מחיר מתחת למרכז הרגרסיה':'מחיר מעל מרכז הרגרסיה',['center']],
   ['volume','מחזור בנר הפתוח ≥ פי 1.5 מממוצע 20 נרות',['volumeData','volume']],
   ['liquidity','מחזור כספי ממוצע ≥ 10,000 USDT לנר',['liquidity']],
   ['signal','איתות חדש ותבנית שלא נוצלה',['new','unused']],
   ['range',sell?'דשדוש קודם בחלק העליון או האמצעי':'דשדוש קודם בחלק התחתון או האמצעי',['range']],
   ['rangeBreak',sell?'יציאה מתחת לטווח הדשדוש':'יציאה מעל טווח הדשדוש',['rangeBreak']],
   ['plan','תקינות האיתות ויעד שטרם הושג',sell?['price','plan']:['atr','plan']]
  ];
  const validSide=side==='LONG'||sell;
  const recent=transport&&Number.isFinite(at)&&at>0&&Number.isFinite(now)&&at<=now&&now-at<(sell?180000:90000);
  const success=reason===(sell?'SHORT_CHANNEL_READY':'CHANNEL_BREAKOUT_READY');
  const stop=stages.findIndex(([,reasons])=>reasons.includes(reason));
  const parallel=conditions!=null;
  const validReport=parallel&&conditions.version===(pocPolicy?'CHANNEL_POC_CONDITIONS_V1':'CHANNEL_CONDITIONS_PARALLEL_V1')&&conditions.side===side&&Number.isFinite(conditions.at)&&conditions.at>0&&conditions.at<=at&&at-conditions.at<15000&&conditions.expiresAt===(Math.floor(conditions.at/STEP)+1)*STEP&&Array.isArray(conditions.rows)&&conditions.rows.length===definitions.length&&definitions.every(([id])=>conditions.rows.filter(r=>r?.id===id&&['passed','waiting','unknown'].includes(r.state)).length===1);
  // An envelope may be recorded just after a candle ends. The report's own
  // expiry remains authoritative; a later delivery time never renews it.
  const timely=recent&&now<(Math.floor(at/STEP)+1)*STEP&&(!sell||Number.isFinite(expiresAt)&&expiresAt>now)&&(!validReport||now<conditions.expiresAt&&now-conditions.at<(sell?180000:90000));
  const known=parallel?validReport:!pocPolicy&&(success||stop>=0),current=validSide&&supported&&timely&&known;
  const passed=new Set(current?stages.slice(0,success?stages.length:stop).map(([key])=>key):[]);
  const failed=current&&!success&&stop>=0?stages[stop][0]:null;
  const rows=definitions.map(([id,label,gates])=>({id,label,state:parallel?(current?conditions.rows.find(r=>r.id===id).state:'unknown'):gates.includes(failed)?'waiting':gates.every(g=>passed.has(g))?'passed':'unknown'}));
  const count=rows.filter(r=>r.state==='passed').length;
  // Null blocker is absence of a reported block, never proof of account approval.
  rows.push({id:'execution',label:'אישור ביצוע · הרשאות, יתרה, מקום והגנות',state:transport&&blocker?'blocked':'unknown'});
  // Data availability is a background prerequisite, not a counted signal.
  const dataPending=validSide&&supported&&recent&&(!parallel||validReport)&&transient.has(reason);
  return {rows,count,total:definitions.length,current,dataPending,parallel:!!validReport,status:!supported?'unsupported':parallel&&!validReport?'invalid-report':!timely?'stale':!known?'unknown':'recorded'};
 }
 function createTracker({market='BINANCE'}={}){
  const records=new Map(),seen=new Set();
  const symbolOK=s=>typeof s==='string'&&(market==='COLMEX'?/^[A-Z][A-Z0-9.-]{0,15}$/.test(s):market==='BINANCE'&&/^[A-Z0-9]{2,24}USDT$/.test(s));
  function update(input){
   const now=input.now??Date.now(),view=project({...input,now}),key=input.side+':'+input.symbol;
   const identity=input.marketSymbol,age=input.side==='SHORT'?180000:90000;
   const firstView=!seen.has(key);seen.add(key);if(seen.size>300)seen.delete(seen.values().next().value);
   // History is presentation-only, per asset/market/side, and keeps the original
   // observation time. Refresh attempts cannot extend its lifetime.
   for(const [k,r] of records)if(!Number.isFinite(now)||now<r.at||now-r.at>=r.age)records.delete(k);
   if(!input.transport||!input.supported||!symbolOK(input.symbol)||!symbolOK(identity)||!['LONG','SHORT'].includes(input.side)){
    records.delete(key);return view;
   }
   let previous=records.get(key);
   if(previous&&(previous.identity!==identity||previous.view.rows.map(r=>r.id).join()!==view.rows.map(r=>r.id).join())){records.delete(key);previous=null;}
   const evidenceAt=view.parallel?input.conditions.at:input.at;
   if(previous&&Number.isFinite(evidenceAt)&&evidenceAt<previous.at)return project({...input,now,transport:false});
   if(view.current&&!view.dataPending){
    records.set(key,{identity,at:evidenceAt,observedAt:input.at,reason:input.reason,age,view});
    if(records.size>300)records.delete(records.keys().next().value);
    return view;
   }
   // A panel opened just after rollover can still label a valid recent report
   // as historical. No cache, chart geometry or reason string creates passes.
   if(firstView&&!previous&&view.status==='stale'&&view.parallel&&now>=evidenceAt&&now-evidenceAt<age&&!view.dataPending){
    const recorded=project({...input,at:evidenceAt,now:evidenceAt,expiresAt:input.conditions.expiresAt});
    if(recorded.current&&!recorded.dataPending)previous={identity,at:evidenceAt,observedAt:input.at,reason:input.reason,age,view:recorded};
    if(previous)records.set(key,previous);
   }
   const sameExpiredScan=view.status==='stale'&&input.at===previous?.observedAt&&(input.reason===previous?.reason||input.side==='SHORT'&&input.reason==='STALE_SHORT_OBSERVATION');
   const awaitingBar=view.dataPending&&transient.has(input.reason)&&input.at>=previous?.at;
   if(previous&&(sameExpiredScan||awaitingBar))return {...view,current:false,count:0,status:'refreshing',previousCount:previous.view.count,previousAt:previous.at,
    rows:view.rows.map(row=>row.id==='execution'?row:{...row,state:'previous_'+previous.view.rows.find(r=>r.id===row.id).state})};
   records.delete(key);return view;
  }
  return {update,clear:()=>{records.clear();seen.clear();},retain:symbols=>{const keep=new Set(symbols);for(const key of records.keys())if(!keep.has(key.slice(key.indexOf(':')+1)))records.delete(key);}};
 }
 root.LEVI_ENTRY_CHECKLIST={project,createTracker};
})(typeof window==='undefined'?globalThis:window);
