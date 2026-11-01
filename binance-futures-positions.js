(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
 const format=(v,d=4)=>number(v)?Number(v).toLocaleString('he-IL',{maximumFractionDigits:d}):'—';
 const time=v=>number(v)&&Number(v)>0?new Date(Number(v)).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}):'—';
 const fresh=(t,now,age)=>number(t)&&Number(t)<=now+1000&&now-Number(t)<=age;
 function view(snapshot,now=Date.now()){
  const f=snapshot?.shortTrading;
  const title='<div class="panel-title-row"><h2>פוזיציות פעילות · SHORT Futures</h2></div>';
  if(snapshot?.mode==='demo')return title+'<p>פוזיציות SHORT שייכות לחשבון LIVE. עבור לתצוגת LIVE כדי לראות אותן.</p>';
  if(!f)return title+'<p>ממתין לנתוני SHORT מהשרת…</p>';
  if(!Array.isArray(f.positions))return title+'<p>נתוני הפוזיציות אינם זמינים. יש לחבר מכשיר כדי לראות את החשבון.</p>';
  const rows=f.positions,account=f.account;
  let html=title+'<p><b>'+rows.length+'/2</b> פוזיציות SHORT · '+(f.enabled?'כניסות מופעלות בכפוף לתנאים':'כניסות כבויות')+' · Isolated · 1x</p>';
  html+='<p>יתרת ארנק Futures: <b>'+format(account?.walletUsdt,2)+' USDT</b> · יתרה פנויה: <b>'+format(account?.availableUsdt,2)+' USDT</b></p>';
  html+='<p class="mini">תקציב המסלול: 70 USDT · עד 35 USDT לכל מקום, כולל רזרבה לעמלות · יתרה זו נפרדת מארנק Spot.</p>';
  if(f.reason)html+='<p>מצב המסלול: <span dir="ltr">'+esc(f.reason)+'</span></p>';
  if(f.halt)html+='<p class="pnl-loss">כניסות חסומות עד בדיקת התקלה: '+esc(f.halt)+'</p>';
  if(!fresh(f.checkedAt,now,60000))html+='<p class="pnl-unknown">נתוני המסלול לא עודכנו לאחרונה. מוצגים הנתונים האחרונים שהתקבלו.</p>';
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
  return html;
 }
 let snapshot=null;
 function paint(){const panel=root.document?.querySelector('#futuresPositionsPanel');if(panel)panel.innerHTML=view(snapshot);}
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
