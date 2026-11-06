(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
 const format=(v,d=4)=>number(v)?Number(v).toLocaleString('he-IL',{maximumFractionDigits:d}):'—';
 const time=v=>number(v)&&Number(v)>0?new Date(Number(v)).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}):'—';
 const fresh=(t,now,age)=>number(t)&&Number(t)<=now+1000&&now-Number(t)<=age;
 const reasons={WAIT_CHANNEL_CONSOLIDATION:'ממתין לדשדוש של לפחות 3 נרות סגורים לפני הכניסה',INVALID_CHANNEL_CONSOLIDATION:'נתוני הדשדוש אינם תקינים',CHANNEL_CONSOLIDATION_SIDE_BLOCK:'מיקום הדשדוש אינו מתאים לכיוון העסקה',WAIT_CHANNEL_CONSOLIDATION_BREAK:'ממתין ליציאה מהדשדוש בכיוון העסקה',CHANNEL_CONSOLIDATION_CHANGED:'הדשדוש השתנה או חסר בבדיקה החוזרת',WAIT_NEW_SHORT_SIGNAL:'ממתין לאיתות SHORT חדש',WAIT_TWO_TOUCHES_PER_SIDE:'ממתין לתעלה עם שתי נגיעות בכל גבול',SHORT_REGRESSION_DIRECTION_BLOCK:'הרגרסיה אינה יורדת',SHORT_REGRESSION_CENTER_BLOCK:'המחיר אינו מתחת למרכז הרגרסיה',WAIT_FUTURES_LIVE_BAR:'ממתין לנתוני מחזור עדכניים של הנר הפתוח',WAIT_LOWER_CHANNEL_LIVE_BREAK:'ממתין לשבירת הגבול התחתון בזמן הנר',WAIT_LOWER_CHANNEL_BREAK:'ממתין לפריצה מטה בנר סגור',SHORT_VOLUME_LOW:'מחזור הפריצה קטן מפי 1.5 מממוצע 20',SHORT_LIQUIDITY_LOW:'שווי המחזור נמוך מהמינימום',SHORT_PRICE_INVALIDATED:'המחיר או נתוני הנר אינם מאפשרים כניסה כעת',SHORT_SIGNAL_EXPIRED:'תוקף האיתות פג',SHORT_CHANNEL_READY:'תנאי האיתות מתקיימים; נדרשת בדיקה לפני שליחה',WAIT_FRESH_FUTURES_PRICE:'ממתין למחיר Futures עדכני',WAIT_FUTURES_HISTORY:'חסרה היסטוריית נרות',FUTURES_SHORT_DISABLED:'כניסות SHORT כבויות',SHORT_TARGET_ALREADY_REACHED:'המחיר כבר הגיע ליעד',SHORT_PATTERN_ALREADY_USED:'התעלה כבר נוצלה',STOP_LOSS:'סטופ הפסד',TRAILING_STOP:'הגנה נגררת',CHANNEL_TAKE_PROFIT:'יעד התעלה',SETTINGS_TAKE_PROFIT:'יעד רווח לפי הגדרות האפליקציה',BROKER_OR_EXTERNAL_CLOSE:'סגירה בבורסה או ממקור חיצוני'};
 Object.assign(reasons,{FUTURES_MARKETS_UNVERIFIED:'רשימת חוזי Futures טרם אומתה',FUTURES_SYMBOL_UNAVAILABLE:'אין חוזה USDT תואם ומאומת למסחר',FUTURES_CONTRACT_VERIFIED:'חוזה Futures תואם אומת',WAIT_SHORT_OBSERVATION:'ממתין לסריקת SHORT ראשונה',STALE_SHORT_OBSERVATION:'סריקת SHORT התיישנה · ממתין לעדכון',FUTURES_OBSERVATION_UNAVAILABLE:'נתוני Futures לא התקבלו · ניסיון נוסף בסבב הבא',FUTURES_HISTORY_UNVERIFIED:'היסטוריית Futures לא אומתה',FUTURES_NOT_IN_SHARED_WATCH:'הנכס הוסר מרשימת המעקב המשותפת',FUTURES_ENTRIES_PAUSED:'פתיחת עסקאות מושהית',FUTURES_TWO_SLOTS_FULL:'שני מקומות השורט תפוסים',FUTURES_NEED_35_USDT_FREE_PER_SLOT:'נדרשים 35 USDT פנויים בארנק Futures',FUTURES_ACCOUNT_UNVERIFIED:'מצב חשבון Futures טרם אומת',FUTURES_ORDER_PENDING:'ממתין לבירור הוראה קיימת',FUTURES_EXTERNAL_POSITION_BLOCK:'קיימת פוזיציה שאינה מנוהלת על ידי הבוט',FUTURES_STOP_ALL:'עצירת מסחר פעילה',FUTURES_SHORT_DISABLED:'פתיחת עסקאות SHORT כבויה',TRADING_PAUSED:'פתיחת עסקאות מושהית',NO_FREE_SLOT:'אין מקום פנוי לעסקה',CHANNEL_PRIMARY_DISABLED:'כניסות בתעלה כבויות',REGRESSION_DIRECTION_BLOCK:'הרגרסיה אינה עולה',REGRESSION_CENTER_BLOCK:'המחיר אינו מעל מרכז הרגרסיה',WAIT_CHANNEL_PIVOTS:'ממתין לנקודות קיצון',WAIT_CHANNEL_TWO_TOUCHES:'ממתין לשתי נגיעות בכל גבול',WAIT_CHANNEL_LIVE_BREAKOUT:'ממתין לפריצת הגבול העליון',WAIT_CHANNEL_LIVE_BAR:'ממתין לנתוני הנר הפתוח',WAIT_CHANNEL_HISTORY:'חסרה היסטוריית נרות',CHANNEL_VOLUME_LOW:'מחזור הפריצה קטן מפי 1.5 מהממוצע',CHANNEL_LIQUIDITY_LOW:'שווי המחזור נמוך מהמינימום',CHANNEL_BREAKOUT_READY:'תנאי LONG מתקיימים · נדרשת בדיקה סופית',CHANNEL_PRIMARY:'מסלול כניסה בתעלה',WAIT_NEW_CHANNEL_SIGNAL:'ממתין לאיתות LONG חדש'});
 const reason=v=>reasons[v]||v||'לא נמסרה סיבה';
 function view(snapshot,now=Date.now()){
  const f=snapshot?.shortTrading;
  const title='<div class="panel-title-row"><h2>פוזיציות פעילות · SHORT Futures</h2></div>';
  if(snapshot?.mode==='demo')return title+'<p class="quiet-empty">פוזיציות SHORT שייכות לחשבון LIVE. עבור לתצוגת LIVE כדי לראות אותן.</p>';
  if(!f)return title+'<p class="quiet-empty">ממתין לנתוני SHORT מהשרת…</p>';
  if(!Array.isArray(f.positions))return title+'<p class="quiet-empty">נתוני הפוזיציות אינם זמינים. יש לחבר מכשיר כדי לראות את החשבון.</p>';
  const rows=f.positions,account=f.account;
  const quotesFresh=rows.every(p=>number(p.entryPrice)&&Number(p.entryPrice)>0&&number(p.qty)&&Number(p.qty)>0&&number(p.currentPrice)&&Number(p.currentPrice)>0&&fresh(p.priceAt,now,60000));
  const totalPnl=quotesFresh&&fresh(f.checkedAt,now,60000)?rows.reduce((sum,p)=>sum+(Number(p.entryPrice)-Number(p.currentPrice))*Number(p.qty),0):null;
  const signedTotal=number(totalPnl)?(totalPnl>0?'+':'')+format(totalPnl,2):'—';
  const warning=!!f.halt||!fresh(f.checkedAt,now,60000)||/API_|UNVERIFIED|NETWORK|UNREADABLE/.test(f.reason||'');
  const stateText=f.halt?'כניסות SHORT חסומות · נדרשת בדיקת התקלה':warning?'נתוני SHORT דורשים בדיקה · מוצג העדכון האחרון':f.enabled?'מסלול SHORT מופעל · כניסה רק לאחר אישור כל התנאים':'כניסות SHORT כבויות';
  let html=title+'<div class="health-banner" data-state="'+(warning?'warning':f.enabled?'good':'neutral')+'" role="status"><span class="health-dot" aria-hidden="true"></span><span>'+stateText+'</span></div>';
  const card=(label,value,note,extra='',sign='')=>'<article class="metric-card '+extra+'"><span>'+label+'</span><strong'+(sign?' data-sign="'+sign+'"':'')+'>'+value+'</strong><small>'+note+'</small></article>';
  const art='<svg class="metric-art" viewBox="0 0 120 50" aria-hidden="true"><circle cx="24" cy="50" r="46" fill="none" stroke="currentColor"/><circle cx="24" cy="50" r="32" fill="none" stroke="currentColor"/><circle cx="24" cy="50" r="18" fill="none" stroke="currentColor"/></svg>';
  html+='<div class="overview-metrics">';
  html+=card('יתרת ארנק Futures · USDT',format(account?.walletUsdt,2),'יתרת הארנק · ללא רווח / הפסד פתוח'+art,'featured');
  html+=card('מזומן זמין · Futures',format(account?.availableUsdt,2),'USDT פנויים להקצאה');
  html+=card('רווח / הפסד לא ממומש · USDT',signedTotal,number(totalPnl)?'לפני עמלות ומימון · לפי מחיר Ask':'ממתין למחירים עדכניים','',totalPnl>0?'positive':totalPnl<0?'negative':'');
  const dots='<div class="slot-dots" aria-hidden="true">'+[0,1].map(i=>'<i'+(i<rows.length?' class="used"':'')+'></i>').join('')+'</div>';
  html+=card('פוזיציות SHORT פעילות',rows.length+'/2',dots+'עד 35 USDT לכל מקום · כולל רזרבה לעמלות');
  html+='</div><div class="workspace-heading"><h2>הפוזיציות שלך · SHORT</h2><span class="mode-tag">USDⓈ-M · Isolated · 1x</span></div>';
  html+='<details class="mini"><summary>מצב המסלול וזמן העדכון</summary><p>בדיקת מסלול אחרונה: '+esc(time(f.checkedAt))+'</p><p>תקציב 70 USDT · ארנק Futures נפרד מ־Spot</p><p dir="ltr">'+esc(reason(f.halt||f.reason))+'</p></details>';
  html+='<p class="mini">'+(f.policy?.exitPolicy==='FUTURES_SHORT_SETTINGS_V2'?'יעד הרווח וההגנה הנגררת לפי הגדרות האפליקציה · יעד התעלה אינו סוגר SHORT.':'יעד הרווח לפי התעלה · הסטופ וההגנה הנגררת לפי ההגדרות.')+'</p>';
  html+='<div class="asset-table-wrap" style="overflow-x:auto"><table class="asset-table wide-table"><thead><tr><th>נכס / כיוון</th><th>מועד כניסה</th><th>כמות</th><th>מחיר כניסה</th><th>מחיר נוכחי (Ask)</th><th>סכום כניסה USDT</th><th>רווח / הפסד USDT</th><th>רווח / הפסד %</th><th>יעד רווח TP</th><th>סטופ נוכחי</th><th>הגנות</th></tr></thead><tbody>';
  for(const p of rows){
   const valid=number(p.entryPrice)&&Number(p.entryPrice)>0&&number(p.qty)&&Number(p.qty)>0;
   const live=valid&&number(p.currentPrice)&&Number(p.currentPrice)>0&&fresh(p.priceAt,now,60000);
   const pnl=live?(Number(p.entryPrice)-Number(p.currentPrice))*Number(p.qty):null;
   const pct=live?(Number(p.entryPrice)-Number(p.currentPrice))/Number(p.entryPrice)*100:null;
   const cls=!live?'pnl-unknown':pnl>0?'pnl-profit':pnl<0?'pnl-loss':'pnl-flat';
   const signed=n=>number(n)?(n>0?'+':'')+format(n,2):'—';
   const protectedNow=fresh(p.protectedAt,now,30000)&&['STOP_MARKET','TAKE_PROFIT_MARKET'].every(kind=>p.algos?.some(a=>a.kind===kind&&a.status==='NEW'));
   html+='<tr><td><b>'+esc(p.symbol)+'</b><br>SHORT</td><td>'+esc(time(p.entryAt))+'</td><td>'+format(p.qty,8)+'</td><td>'+format(p.entryPrice,8)+'</td><td>'+format(p.currentPrice,8)+'<br><small>'+(live?'עודכן: ':'מחיר לא עדכני: ')+esc(time(p.priceAt))+'</small></td><td>'+format(valid?Number(p.entryPrice)*Number(p.qty):null,2)+'</td><td class="'+cls+'">'+signed(pnl)+'</td><td class="'+cls+'">'+signed(pct)+(live?'%':'')+'</td><td>'+format(p.targetPrice,8)+'</td><td>'+format(p.stopPrice,8)+'</td><td>'+(protectedNow?'אומתו בבורסה':'לא אומתו לאחרונה')+'<br><small>'+esc(time(p.protectedAt))+'</small></td></tr>';
  }
  if(!rows.length)html+='<tr><td colspan="11">אין כרגע פוזיציות SHORT מתועדות פתוחות.</td></tr>';
  html+='</tbody></table></div><p class="mini">רווח / הפסד לא ממומש מחושב לפי מחיר הקנייה החוזרת (Ask), לפני עמלות ומימון. מחיר חסר או ישן לא מוצג כרווח אפס. זמני התצוגה בשעון ישראל.</p>';
  if(f.policy?.consolidationPolicy?.version==='CHANNEL_CONSOLIDATION_V1')html+='<p>'+esc('דשדוש לפני הכניסה: לפחות 3 נרות סגורים בטווח צר. עליון מתאים ל־SHORT, תחתון ל־LONG, ואמצעי מאפשר את שני הכיוונים. הדשדוש יכול להיות בכל שלב בתעלה; נדרשת יציאה ממנו בכיוון העסקה וכל תנאי הכניסה הקיימים.')+'</p>';
  const shared=f.watch?.policy?.version==='SHARED_LONG_SHORT_WATCH_V1'?f.watch:null;
  if(shared){
   html+='<details data-short-detail="shared"><summary>מעקב LONG / SHORT משותף · '+shared.rows.length+' נכסים</summary><p class="mini">הסריקה ממשיכה גם כשפתיחת עסקאות חסומה. תנאי השורט נבדקים על גרף חוזה Futures, בנפרד מ־Spot.</p><p>ביצוע SHORT: '+esc(shared.entryBlocker?reason(shared.entryBlocker):'כפוף לבדיקת ההרשאות וההגנות לפני שליחה')+'</p><div class="asset-table-wrap" style="overflow-x:auto"><table class="asset-table"><thead><tr><th>נכס במעקב Spot</th><th>חוזה SHORT תואם</th><th>סריקה אחרונה</th><th>תוצאת בדיקת SHORT</th></tr></thead><tbody>';
   for(const row of shared.rows){const current=fresh(shared.checkedAt,now,90000)&&fresh(row.at,now,180000)&&row.expiresAt>now;const result=!fresh(shared.checkedAt,now,90000)?'STALE_SHORT_OBSERVATION':!row.available?row.mappingReason:current?row.reason:row.at?'STALE_SHORT_OBSERVATION':'WAIT_SHORT_OBSERVATION';html+='<tr><td>'+esc(row.spotSymbol)+'</td><td>'+esc(row.futuresSymbol||'לא זמין')+'</td><td>'+esc(time(row.at))+'</td><td>'+esc(reason(result))+'</td></tr>';}
   html+='</tbody></table></div></details>';
  }
  const checks=Object.entries(f.checks||{}).sort((a,b)=>Number(b[1]?.at||0)-Number(a[1]?.at||0));
  html+='<details data-short-detail="checks"><summary>סריקת SHORT · '+checks.length+' נכסים עם תוצאה מתועדת</summary><div class="asset-table-wrap" style="overflow-x:auto"><table class="asset-table"><thead><tr><th>נכס</th><th>בדיקה אחרונה</th><th>סיבת המתנה / תוצאה</th></tr></thead><tbody>';
  for(const [symbol,c] of checks){
   const watch=root.LEVI_CHANNEL_WATCH?.candidate({reason:c.reason,at:c.at,now,enabled:f.enabled===true&&!f.halt&&fresh(f.checkedAt,now,60000),held:rows.some(p=>p.symbol===symbol)});
   const consolidation=c.consolidation||c.setup?.consolidation;
   const consolidationNote=consolidation?.zone?' · דשדוש '+({UPPER:'עליון',LOWER:'תחתון',MIDDLE:'אמצעי'}[consolidation.zone]||'')+' · '+consolidation.bars+' נרות · עד '+time(consolidation.endAt):'';
   html+='<tr'+(watch?' class="channel-watch"':'')+'><td>'+esc(symbol)+'</td><td>'+esc(time(c.at))+(fresh(c.at,now,60000)?'':' · נתון קודם')+'</td><td>'+esc(reason(c.reason))+esc(consolidationNote)+(watch?'<div class="channel-watch-badge" data-watch-expires="'+watch.expiresAt+'">'+esc(watch.text)+' · לא אישור מכירה</div>':'')+'</td></tr>';
  }
  if(!checks.length)html+='<tr><td colspan="3">טרם התקבלו תוצאות סריקה. אין בכך אישור שאין מועמדים.</td></tr>';
  html+='</tbody></table></div></details>';
  const closed=Array.isArray(f.closed)?f.closed:[];
  html+='<details data-short-detail="closed"><summary>סגירות SHORT אחרונות · '+closed.length+'</summary><p class="mini">מועד הסגירה הוא מועד הזיהוי בשרת. מחיר מילוי הסגירה ורווח ממומש אינם כלולים בנתונים אלה.</p><div class="asset-table-wrap" style="overflow-x:auto"><table class="asset-table"><thead><tr><th>נכס</th><th>כניסה</th><th>סגירה זוהתה</th><th>מחיר כניסה</th><th>סיבה מתועדת</th></tr></thead><tbody>';
  for(const p of [...closed].reverse())html+='<tr><td>'+esc(p.symbol)+'</td><td>'+esc(time(p.entryAt))+'</td><td>'+esc(time(p.closedAt))+'</td><td>'+format(p.entryPrice,8)+'</td><td>'+esc(reason(p.reason))+'</td></tr>';
  if(!closed.length)html+='<tr><td colspan="5">אין סגירות מתועדות בנתונים שהתקבלו.</td></tr>';
  html+='</tbody></table></div></details>';
  return html;
 }
 let snapshot=null;
 function paint(){const panel=root.document?.querySelector('#futuresPositionsPanel');if(panel){const opened=Array.from(panel.querySelectorAll?.('details[open][data-short-detail]')||[],e=>e.dataset.shortDetail);panel.innerHTML=view(snapshot);for(const e of panel.querySelectorAll?.('details[data-short-detail]')||[])e.open=opened.includes(e.dataset.shortDetail);}}
 function update(s){
  if(s?.mode==='demo'){snapshot={mode:'demo'};paint();return;}
  // Agent fallback snapshots have no Futures data; do not erase an authenticated mode response.
  if(!Object.hasOwn(s||{},'shortTrading'))return;
  snapshot=s;paint();
 }
 root.LEVI_FUTURES_TABLE={update,view,reason};
 root.addEventListener?.('trade-device-expired',()=>{snapshot=null;paint();});
 if(root.document){paint();root.setInterval(()=>{if(!root.document.hidden)paint();},15000);}
})(typeof window==='undefined'?globalThis:window);
