import {renderEntryComparison} from './entry-comparison-ui.js?v=20261030-independent-entry';
import {renderTradingResearch} from './trading-research-ui.js?v=20261027-research2';
const modes={spring_rsi_live:'Spring מיידי · קודם',early_wave_live:'גל מוקדם · קודם',spring_reclaim_confirmed:'Spring לאחר חזרה',early_wave_confirmed:'גל מוקדם מאושר',independent_breakout:'פריצה עצמאית · LIVE',unknown:'מקור לא ידוע',manual_external:'ידני',mixed_or_multiple_entries:'כניסות מעורבות'};
const variants={legacy:'כללים קודמים',confirmed:'אישור נר בלבד',confirmed_trend:'אישור + מגמה',confirmed_volume:'אישור + מחזור',full_quality:'אישור + מגמה + מחזור'};
const number=(n,suffix='')=>Number.isFinite(n)?n.toLocaleString('he-IL',{maximumFractionDigits:3})+suffix:'—';
export function renderStrategyReview(host,data,{document:doc=globalThis.document,currency='USD'}={}){
 if(!host)return;
 const openIds=new Set(Array.from(host.querySelectorAll?.('details[open]')||[],e=>e.id).filter(Boolean));
 const restore=()=>{for(const e of host.querySelectorAll?.('details')||[])e.open=openIds.has(e.id);};
 host.replaceChildren();
 const add=(tag,text,parent=host)=>{const e=doc.createElement(tag);e.textContent=text;parent.append(e);return e;};
 if(!data){add('p','ממתין לנתוני גרסת האסטרטגיה מהשרת. תצוגה זו אינה מאשרת שהעדכון הותקן במנוע המסחר.');renderEntryComparison(host,null,{document:doc});renderTradingResearch(host,null,{document:doc,modes,variants});restore();return;}
 add('p','מעקב נפרד לכל מסלול וגרסה · נרות 5 דקות סגורים · MA100/200 על ארבעה נרות · מחזור נר האישור לפחות כממוצע 20 קודמיו. מרחק הסטופ בבייננס נקבע ב־SETTINGS; בקולמקס קיימת גם התאמה ל־ATR ולמבנה, עד 3%.');
 if(data.independentEntry){
  const route=data.independentEntry;
  add('h3','מסלול פריצה עצמאית · קבלת החלטות בלייב');
  add('p',route.enabled&&route.executionEnabled?'מאופשר בלייב · יכול לפתוח עסקה גם בלי Spring, בכפוף לבדיקות החשבון, ההקצאה וההגנות.':route.enabled?'המסלול מאופשר, אך ביצוע LIVE אינו מופעל כרגע.':'מסלול הפריצה העצמאית אינו מופעל בשרת.');
  add('p','נר 5 דקות סגור מעל שיא 20 הנרות הקודמים · מחזור לפחות פי 1.5 · שווי מחזור ממוצע לפחות 10,000 דולר לנר · בדיקת MA100/200. איתות תקף לחמש דקות ונבדק שוב לפני ההוראה. למסלול הקיים קדימות כששניהם מאשרים כניסה.');
  add('p','תוצאות המחקר והסימולציה ממשיכות להימדד בנפרד. הן אינן משנות את הכללים אוטומטית.');
 }
 if(data.error||data.dropped)add('p','חלק מתיעוד ההשוואה חסר או לא נשמר. אין להסיק מסקנות מהנתונים החלקיים.');
 const table=(headers,rows)=>{const wrap=add('div','');wrap.className='strategy-table-wrap';const t=add('table','',wrap),head=add('thead','',t),hr=add('tr','',head);for(const h of headers)add('th',h,hr);const body=add('tbody','',t);for(const row of rows){const tr=add('tr','',body);for(const value of row)add('td',String(value),tr);}};
 if(currency==='USDT'){
  add('h3','השוואת תעלות · תצפית בלבד');
  const c=data.channelComparison;
  add('p','רגרסיה מול תעלה מקבילה · 100 נרות של 5 דקות · תחזית קפואה ל־30 דקות. המדגם משותף לשתי השיטות; אינו בודק רווחי מסחר ואינו משנה החלטות. הגדרות התצוגה בגרף אינן משנות את המחקר.');
  if(!c)add('p','השרת טרם מסר נתוני מעקב תעלות. נדרשת התקנת עדכון המעקב בשרת; הצגת הקווים לבדה אינה מפעילה אותו.');
  else{
   add('p','מדגמים שהושלמו: '+c.resolved+' · ממתינים: '+c.pending+' · חסרי המשך: '+c.expired+' · זוגות תקפים: '+c.paired+' מתוך '+c.eligible+' בדיקות · עדכון אחרון: '+new Date(c.lastAt).toLocaleString('he-IL'));
   table(['שיטה','שגיאת מרכז ממוצעת ↓','כיוון נכון','סגירה בתוך התעלה','רוחב ממוצע'],[['regression','רגרסיה · כחול/סגול'],['parallel','מקבילה · כתום']].map(([key,label])=>[label,number(c[key].meanErrorPct,'%'),number(c[key].directionPct,'%')+' (n='+c[key].directionCount+')',number(c[key].containmentPct,'%'),number(c[key].meanWidthPct,'%')]));
   add('p','יותר הכלה יכולה לנבוע מתעלה רחבה יותר. המדגם כולל רק זמנים ששתי השיטות היו זמינות, כולל תעלות מקבילות ראשוניות. אין הכרזה אוטומטית על שיטה מנצחת.');
  }
 }
 renderEntryComparison(host,data.entryComparison,{document:doc});
 add('h3','עסקאות אמיתיות שנסגרו');
 if(!data.actual?.length)add('p','טרם נצברו עסקאות סגורות ביומן הזמין.');
 else table(['מסלול / גרסה','עסקאות','ברוטו','נטו מאומת','הצלחות נטו','רווח ממוצע / הפסד ממוצע','ירידה מצטברת ממומשת'],data.actual.map(g=>[(modes[g.entryMode]||g.entryMode)+' · '+g.version,g.closed,number(g.grossKnown===g.closed?g.grossPnl:null,' '+currency),g.netKnown===g.closed?number(g.netPnl,' '+currency):'עמלות/עלות חסרות · '+g.netKnown+'/'+g.closed+' אומתו',number(g.netWinRate,'%'),number(g.averageWin)+' / '+number(g.averageLoss),number(g.maxClosedDrawdown,' '+currency)]));
 add('h3','השוואת איתותים קדימה · ללא ביצוע עסקאות');
 add('p','נמדד שינוי המחיר כעבור כ־30 דקות מהאיתות שנצפה. זו אינה תשואת אסטרטגיה: אין ביצוע, עמלות או הפעלת סטופ בהשוואה זו. אותות שלא קיבלו מחיר המשך בזמן מסומנים כחסרים. ההשוואה מתחילה מהתקנת העדכון ואינה שחזור עסקאות עבר.');
 if(!data.observations?.length)add('p','ממתין לאיתותים חדשים ולמחירי המשך; עדיין אין בסיס למסקנה על שיפור.');
 else table(['מסלול / בדיקה','איתותים','עם מחיר המשך','עלייה לאחר האיתות','שינוי מחיר ממוצע','מחיר המשך חסר'],data.observations.map(g=>[(modes[g.entryMode]||g.entryMode)+' · '+(variants[g.variant]||g.variant),g.observed,g.resolved,number(g.positivePct,'%'),number(g.meanReturnPct,'%'),g.expired]));
 add('small','גם ירידה מצטברת בטבלה מתייחסת לעסקאות סגורות בלבד, ולא לשווי התיק כולל פוזיציות פתוחות. תוצאות לפי גרסאות שונות אינן מאוחדות.');
 if(data.actual?.length){add('h3','איכות תוצאות נטו');table(['מסלול / גרסה','נטו ממוצע לעסקה','יחס סך רווחים לסך הפסדים'],data.actual.map(g=>[(modes[g.entryMode]||g.entryMode)+' · '+g.version,number(g.expectancyNet,' '+currency),number(g.profitFactor)]));add('p','היחס אינו מוצג כשאין הפסדים מאומתים או כשהעמלות חסרות. ממוצע עבר אינו תחזית לעסקה הבאה.');}
 renderTradingResearch(host,data.research,{document:doc,modes,variants});
 restore();
}
if(typeof window!=='undefined'&&typeof document!=='undefined'){
 const host=document.getElementById('strategyReviewBody'),binance=document.body.dataset.platform==='binance'||!!document.getElementById('actionJournal');
 const render=data=>renderStrategyReview(host,data,{currency:binance?'USDT':'USD'});
 window.addEventListener('levi-colmex-rsi',e=>render(e.detail?.strategyReview));
 window.addEventListener('levi:colmex-status-error',()=>render(null));
 window.addEventListener('levi:strategy-review',e=>render(e.detail));
 render(window.LEVI_STRATEGY_REVIEW_DATA||window.LEVI_COLMEX_STATUS?.data?.strategyReview);
}
