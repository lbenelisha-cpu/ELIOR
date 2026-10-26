import {renderTradingResearch} from './trading-research-ui.js?v=20261027-research';
const modes={spring_rsi_live:'Spring מיידי · קודם',early_wave_live:'גל מוקדם · קודם',spring_reclaim_confirmed:'Spring לאחר חזרה',early_wave_confirmed:'גל מוקדם מאושר',unknown:'מקור לא ידוע',manual_external:'ידני',mixed_or_multiple_entries:'כניסות מעורבות'};
const variants={legacy:'כללים קודמים',confirmed:'אישור נר בלבד',confirmed_trend:'אישור + מגמה',confirmed_volume:'אישור + מחזור',full_quality:'אישור + מגמה + מחזור'};
const number=(n,suffix='')=>Number.isFinite(n)?n.toLocaleString('he-IL',{maximumFractionDigits:3})+suffix:'—';
export function renderStrategyReview(host,data,{document:doc=globalThis.document,currency='USD'}={}){
 if(!host)return;host.replaceChildren();
 const add=(tag,text,parent=host)=>{const e=doc.createElement(tag);e.textContent=text;parent.append(e);return e;};
 if(!data){add('p','ממתין לנתוני גרסת האסטרטגיה מהשרת. תצוגה זו אינה מאשרת שהעדכון הותקן במנוע המסחר.');renderTradingResearch(host,null,{document:doc,modes,variants});return;}
 add('p','מעקב נפרד לכל מסלול וגרסה · נרות 5 דקות סגורים · MA100/200 על ארבעה נרות · מחזור נר האישור לפחות כממוצע 20 קודמיו. מרחק הסטופ נקבע בכניסה לפי ATR והמבנה, עד 3%, תוך הקטנת הכמות.');
 if(data.error||data.dropped)add('p','חלק מתיעוד ההשוואה חסר או לא נשמר. אין להסיק מסקנות מהנתונים החלקיים.');
 const table=(headers,rows)=>{const wrap=add('div','');wrap.className='strategy-table-wrap';const t=add('table','',wrap),head=add('thead','',t),hr=add('tr','',head);for(const h of headers)add('th',h,hr);const body=add('tbody','',t);for(const row of rows){const tr=add('tr','',body);for(const value of row)add('td',String(value),tr);}};
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
}
if(typeof window!=='undefined'&&typeof document!=='undefined'){
 const host=document.getElementById('strategyReviewBody'),binance=document.body.dataset.platform==='binance'||!!document.getElementById('actionJournal');
 const render=data=>renderStrategyReview(host,data,{currency:binance?'USDT':'USD'});
 window.addEventListener('levi-colmex-rsi',e=>render(e.detail?.strategyReview));
 window.addEventListener('levi:colmex-status-error',()=>render(null));
 window.addEventListener('levi:strategy-review',e=>render(e.detail));
 render(window.LEVI_STRATEGY_REVIEW_DATA||window.LEVI_COLMEX_STATUS?.data?.strategyReview);
}
