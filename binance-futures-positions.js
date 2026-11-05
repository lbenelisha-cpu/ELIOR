(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
 const format=(v,d=4)=>number(v)?Number(v).toLocaleString('he-IL',{maximumFractionDigits:d}):'—';
 const time=v=>number(v)&&Number(v)>0?new Date(Number(v)).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}):'—';
 const fresh=(t,now,age)=>number(t)&&Number(t)<=now+1000&&now-Number(t)<=age;
 const reasons={WAIT_NEW_SHORT_SIGNAL:'ממתין לאיתות SHORT חדש',WAIT_TWO_TOUCHES_PER_SIDE:'ממתין לתעלה עם שתי נגיעות בכל גבול',SHORT_REGRESSION_DIRECTION_BLOCK:'הרגרסיה אינה יורדת',SHORT_REGRESSION_CENTER_BLOCK:'המחיר אינו מתחת למרכז הרגרסיה',WAIT_FUTURES_LIVE_BAR:'ממתין לנתוני מחזור עדכניים של הנר הפתוח',WAIT_LOWER_CHANNEL_LIVE_BREAK:'ממתין לשבירת הגבול התחתון בזמן הנר',WAIT_LOWER_CHANNEL_BREAK:'ממתין לפריצה מטה בנר סגור',SHORT_VOLUME_LOW:'מחזור הפריצה קטן מפי 1.5 מממוצע 20',SHORT_LIQUIDITY_LOW:'שווי המחזור נמוך מהמינימום',SHORT_PRICE_INVALIDATED:'המחיר או נתוני הנר אינם מאפשרים כניסה כעת',SHORT_SIGNAL_EXPIRED:'תוקף האיתות פג',SHORT_CHANNEL_READY:'תנאי האיתות מתקיימים; נדרשת בדיקה לפני שליחה',WAIT_FRESH_FUTURES_PRICE:'ממתין למחיר Futures עדכני',WAIT_FUTURES_HISTORY:'חסרה היסטוריית נרות',FUTURES_SHORT_DISABLED:'כניסות SHORT כבויות',SHORT_TARGET_ALREADY_REACHED:'המחיר כבר הגיע ליעד',SHORT_PATTERN_ALREADY_USED:'התעלה כבר נוצלה',STOP_LOSS:'סטופ הפסד',TRAILING_STOP:'הגנה נגררת',SETTINGS_TAKE_PROFIT:'יעד רווח לפי ההגדרות',CHANNEL_TAKE_PROFIT:'יעד התעלה',BROKER_OR_EXTERNAL_CLOSE:'סגירה בבורסה או ממקור חיצוני'};
 const reason=v=>reasons[v]||v||'לא נמסרה סיבה';
 function rules(snapshot,f,rows){
  const settings=snapshot.exitSettings||{},pct=v=>number(v)?format(v)+'%':'לא התקבל מהשרת';
  const source=f.exitCalculationSource==='SETTINGS_V1';
  let html='<details data-short-detail="rules"><summary>כללי כניסה ויציאה · SHORT</summary><h3>פתיחת SHORT — מכירה תחילה</h3><ul>';
  html+='<li>תעלת קיצון מאושרת על '+format(f.policy?.period??50,0)+' נרות של 5 דקות, עם שתי נגיעות לפחות בכל גבול.</li><li>רגרסיה יורדת והמחיר מתחת למרכז הרגרסיה ולגבול התחתון של התעלה.</li><li>פריצה במחיר חי בזמן הנר; אין המתנה לסגירתו. המחזור המצטבר בנר לפחות פי 1.5 מממוצע 20 הנרות הקודמים.</li><li>שווי מחזור ממוצע של 10,000 USDT לפחות; נתוני מחיר ומחזור עדכניים, איתות בתוקף שלא נוצל.</li><li>עד שתי פוזיציות, עד 35 USDT למקום כולל רזרבה לעמלות, Isolated במינוף 1x. החשבון, היתרה, הרשאות המסחר וההגנות נבדקים לפני ביצוע.</li></ul>';
  html+='<p class="mini">כניסת POC ידנית היא מסלול נפרד לפי המחיר שנבחר; תנאי איתות התעלה אינם חלים עליה.</p><h3>סגירת SHORT — קנייה חוזרת</h3>';
  html+='<p>'+(source?'השרת מדווח שהיציאות מחושבות לפי ההגדרות, גם בפוזיציות מנוהלות קיימות.':'מדיניות היציאה לפי ההגדרות טרם אומתה בשרת. יש לבדוק את היעד והסטופ המתועדים בכל פוזיציה.')+'</p>';
  html+='<ul><li>יעד רווח בהגדרות: <strong>'+pct(settings.takeProfitPct)+'</strong>. בחישוב לפי ההגדרות: מחיר כניסה × (1 − אחוז היעד ÷ 100). הגעה ליעד מפעילה סגירה.</li><li>סטופ הפסד: <strong>'+pct(settings.stopLossPct)+'</strong>. סף התחלתי: מחיר כניסה × (1 + אחוז הסטופ ÷ 100).</li><li>הפעלת הגנת רווח: <strong>'+pct(settings.profitActivationPct)+'</strong>. מופעלת כאשר המחיר יורד לסף; ההפעלה עצמה אינה מכירה.</li><li>מרווח נגרר: <strong>'+(number(settings.trailingGapPp)?format(settings.trailingGapPp)+' נקודות אחוז':'לא התקבל מהשרת')+'</strong> ממחיר הכניסה. לאחר ההפעלה: השפל שנקלט מאז הכניסה ועוד המרווח. הסטופ יורד עם שפל חדש ואינו עולה חזרה.</li></ul><p class="mini">סגירה נבדקת לפי מחיר הקנייה החוזרת (Ask). הספים לפני עמלות ומימון; מחיר הביצוע אינו מובטח. הגדרות כלליות אינן אישור לפקודות שהתקבלו בבורסה.</p>';
  for(const p of rows){
   const s=p.settings||{},state=p.armed===true?'הגנה נגררת פעילה':p.armed===false?'ממתינה להפעלת ההגנה':'מצב הפעלה לא נמסר';
   html+='<h3>'+esc(p.symbol)+' · '+state+'</h3><p>מדיניות מתועדת: '+(p.exitCalculationSource==='SETTINGS_V1'||p.setup?.entryMode==='POC'?'יעד לפי ההגדרות':'יש לבדוק את היעד השמור')+' · מחיר עודכן '+esc(time(p.priceAt))+'</p><dl>';
   for(const [label,value] of [['מחיר כניסה',format(p.entryPrice,8)],['יעד מכירה מתועד',format(p.targetPrice,8)],['סטופ נוכחי מתועד',format(p.stopPrice,8)],['סף הפעלת הגנה מתועד',format(p.activationPrice,8)],['שפל מאז הכניסה',format(p.lowPrice,8)],['סטופ הפסד בהגדרות הפוזיציה',pct(s.stopLossPct)],['הפעלת הגנה בהגדרות הפוזיציה',pct(s.profitActivationPct)],['מרווח נגרר בנקודות אחוז',format(s.trailingGapPp)]])html+='<dt>'+label+'</dt><dd>'+value+'</dd>';
   html+='</dl>';
  }
  return html+'</details>';
 }
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
  html+='</div>'+rules(snapshot,f,rows)+'<div class="workspace-heading"><h2>הפוזיציות שלך · SHORT</h2><span class="mode-tag">USDⓈ-M · Isolated · 1x</span></div>';
  html+='<details class="mini"><summary>מצב המסלול וזמן העדכון</summary><p>בדיקת מסלול אחרונה: '+esc(time(f.checkedAt))+'</p><p>תקציב 70 USDT · ארנק Futures נפרד מ־Spot</p><p dir="ltr">'+esc(reason(f.halt||f.reason))+'</p></details>';
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
  const checks=Object.entries(f.checks||{}).sort((a,b)=>Number(b[1]?.at||0)-Number(a[1]?.at||0));
  html+='<details data-short-detail="checks"><summary>סריקת SHORT · '+checks.length+' נכסים עם תוצאה מתועדת</summary><div class="asset-table-wrap" style="overflow-x:auto"><table class="asset-table"><thead><tr><th>נכס</th><th>בדיקה אחרונה</th><th>סיבת המתנה / תוצאה</th></tr></thead><tbody>';
  for(const [symbol,c] of checks){
   const watch=root.LEVI_CHANNEL_WATCH?.candidate({reason:c.reason,at:c.at,now,enabled:f.enabled===true&&!f.halt&&fresh(f.checkedAt,now,60000),held:rows.some(p=>p.symbol===symbol)});
   html+='<tr'+(watch?' class="channel-watch"':'')+'><td>'+esc(symbol)+'</td><td>'+esc(time(c.at))+(fresh(c.at,now,60000)?'':' · נתון קודם')+'</td><td>'+esc(reason(c.reason))+(watch?'<div class="channel-watch-badge" data-watch-expires="'+watch.expiresAt+'">'+esc(watch.text)+' · לא אישור מכירה</div>':'')+'</td></tr>';
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
 root.LEVI_FUTURES_TABLE={update,view};
 root.addEventListener?.('trade-device-expired',()=>{snapshot=null;paint();});
 if(root.document){paint();root.setInterval(()=>{if(!root.document.hidden)paint();},15000);}
})(typeof window==='undefined'?globalThis:window);
