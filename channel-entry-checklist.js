/* Read-only projection of the server's ordered channel checks. Never authorizes a trade. */
(function(root){
 const STEP=300000;
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
 function project({side,reason,at,now=Date.now(),expiresAt,transport=false,supported=false,blocker=null}={}){
  const sell=side==='SHORT',stages=sell?short:long;
  const definitions=[
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
  const timely=transport&&Number.isFinite(at)&&at>0&&Number.isFinite(now)&&at<=now&&now-at<(sell?180000:90000)&&now<(Math.floor(at/STEP)+1)*STEP&&(!sell||Number.isFinite(expiresAt)&&expiresAt>now);
  const success=reason===(sell?'SHORT_CHANNEL_READY':'CHANNEL_BREAKOUT_READY');
  const stop=stages.findIndex(([,reasons])=>reasons.includes(reason));
  const known=success||stop>=0,current=validSide&&supported&&timely&&known;
  const passed=new Set(current?stages.slice(0,success?stages.length:stop).map(([key])=>key):[]);
  const failed=current&&!success?stages[stop][0]:null;
  const rows=definitions.map(([id,label,gates])=>({id,label,state:gates.includes(failed)?'waiting':gates.every(g=>passed.has(g))?'passed':'unknown'}));
  const count=rows.filter(r=>r.state==='passed').length;
  // Null blocker is absence of a reported block, never proof of account approval.
  rows.push({id:'execution',label:'אישור ביצוע · הרשאות, יתרה, מקום והגנות',state:transport&&blocker?'blocked':'unknown'});
  // Data availability is a background prerequisite, not a counted signal.
  const dataPending=current&&['quote','bar','history'].includes(failed);
  return {rows,count,total:definitions.length,current,dataPending,status:!supported?'unsupported':!timely?'stale':!known?'unknown':'recorded'};
 }
 root.LEVI_ENTRY_CHECKLIST={project};
})(typeof window==='undefined'?globalThis:window);
