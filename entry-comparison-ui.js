const methods={current:'כללים נוכחיים · וואיקוף וגל מוקדם',breakout:'פריצה עצמאית + מחזור'};
const categories={READY:'איתות מוכן',STRATEGY:'תנאי אסטרטגיה',DATA:'נתונים',ACCOUNT_OR_EXECUTION:'חשבון / ביצוע',CAPITAL_OR_RISK:'תקציב / סיכון',MARKET_HOURS:'שעות מסחר'};
const phases={development:'14 ימים ראשונים',validation:'7 ימי אימות',holdout:'7 ימים נוספים שלא שימשו לכיול',continuation:'המשך מעקב'};
const n=(v,s='')=>Number.isFinite(v)?v.toLocaleString('he-IL',{maximumFractionDigits:3})+s:'—';
const date=t=>Number.isFinite(t)?new Date(t).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}):'טרם התחיל';
export function renderEntryComparison(host,data,{document:doc=globalThis.document}={}){
 const add=(tag,text,parent=host)=>{const e=doc.createElement(tag);e.textContent=text;parent.append(e);return e;};
 const box=add('details','');box.id='entryMethodComparison';box.className='research-details';add('summary','וואיקוף מול פריצה עצמאית · סימולציית עסקאות',box);
 add('p','השוואה בלבד. מסלול הפריצה בסימולציה אינו שולח פקודות קנייה. הוא אינו דורש Spring, שתי התאוששויות או RSI נמוך. הרשאת מסלול הפריצה בלייב מוצגת בנפרד לפי מצב השרת.',box);
 if(!data){add('p','ממתין לאימות מנוע ההשוואה ולאיסוף נרות. אין תוצאות מחושבות עדיין.',box);return;}
 add('p','פריצה: סגירת נר 5 דקות מעל שיא 20 קודמיו, מחזור לפחות פי 1.5 מהממוצע ושווי מחזור ממוצע של 10,000 דולר לנר לפחות. מסנן MA100/200 משותף. אלו ספי ניסוי קבועים, לא יתרון שהוכח.',box);
 add('p','תחילת איסוף: '+date(data.startedAt)+' · עדכון: '+date(data.lastAt)+' · '+data.universe.length+' נכסים ברשימת הסריקה. מניה שאינה ברשימה אינה נבדקת אוטומטית.',box);
 if(data.error)add('p','חלק מההשוואה אינו זמין: '+data.error+'. אין להסיק מסקנות מנתונים חסרים.',box);
 const table=(headers,rows,parent=box)=>{const wrap=add('div','',parent);wrap.className='strategy-table-wrap';const t=add('table','',wrap),head=add('tr','',add('thead','',t)),body=add('tbody','',t);headers.forEach(h=>add('th',h,head));for(const row of rows){const tr=add('tr','',body);row.forEach(v=>add('td',String(v),tr));}};
 add('p','כל עסקה מדומה מקבלת אותה יחידת סיכון התחלתית R ואותם אחוזי יציאה מ־SETTINGS. הכמות מחושבת לפי מרחק הסטופ. זו השוואת כניסות ללא מגבלת מזומן או מספר פוזיציות כללית; אינה תשואת תיק. הסטופ בקולמקס בלייב עשוי להתרחב לפי ATR, ואילו כאן שני המסלולים משתמשים באחוזים זהים וקבועים.',box);
 add('p','איתות מחושב רק בסגירת נר; כניסה מדומה בפתיחת הנר הבא. חורים בנתונים מסומנים כחסרים. סטופ, יעד והגנת רווח מחושבים לאורך העסקה. כשסדר השיא והשפל אינו ידוע, נבחרת התוצאה הנמוכה מבין שני סדרי תנועה אפשריים ומסומנת אי־ודאות. זו הנחת סימולציה, לא הבטחת מחיר ביצוע.',box);
 if(!data.cohorts.length)add('p','ממתין לנרות תקינים. ההשוואה אינה ממלאת עסקאות מלפני תחילת האיסוף.',box);
 for(const c of data.cohorts){
  const group=add('details','',box);group.id='entryComparisonCohort-'+c.id;group.className='research-details';add('summary','קבוצת הגדרות '+c.id+(c.id===data.activeId?' · נוכחית':' · קודמת')+' · '+c.symbols+' נכסים',group);
  const s=c.config.settings,k=c.config.costs;
  add('p','סטופ '+n(s.stopLossPct,'%')+' · הפעלת הגנת רווח '+n(s.profitActivationPct,'%')+' · מרחק מהשיא '+n(s.trailingGapPp,' נקודות אחוז ממחיר הכניסה')+' · יעד '+n(s.takeProfitPct,'%')+'. שינוי SETTINGS יוצר קבוצה נפרדת; עסקאות פתוחות בקבוצה קודמת שומרות על הגדרותיהן.',group);
  add('p','בכל צד של העסקה: עמלה משוערת '+n(k.feeBps/100,'%')+', חצי מרווח '+n(k.halfSpreadBps/100,'%')+' והחלקה '+n(k.slippageBps/100,'%')+'. אלו הנחות מפורשות ולא עמלות החשבון בפועל. רווח נטו בטבלה הוא נטו מדומה לאחר הנחות אלו.',group);
  table(['מסלול','איתותים','סגורות / פתוחות','נטו מדומה R','ממוצע לעסקה R','הצלחות','יחס רווחים / הפסדים','ירידה ברצף הסגירות R','חסרות'],c.methods.map(m=>[methods[m.method],m.signals,m.closed+' / '+m.open,n(m.netR),n(m.meanNetR),n(m.winRate,'%'),n(m.profitFactor),n(m.maxClosedDrawdownR),m.incomplete]),group);
  add('p','הירידה בטבלה מחושבת מעסקאות סגורות בלבד; אינה ירידת שווי תיק כולל פוזיציות פתוחות. אי־ודאות תוך־נרית: '+c.methods.map(m=>methods[m.method]+' '+m.ambiguousTrades+' עסקאות').join(' · ')+'. '+(c.pruned?c.pruned+' עסקאות ישנות הוצאו ממגבלת השמירה; התוצאות מתארות את החלון השמור.':''),group);
  if(c.dataProblems.length)add('p','פערי כיסוי: '+c.dataProblems.map(x=>x.symbol+' '+x.reason).join(' · '),group);
  const windows=add('details','',group);windows.id='entryComparisonPhases-'+c.id;add('summary','חלוקה בזמן · ללא בחירת מנצח אוטומטית',windows);
  table(['תקופה','מסלול','עסקאות סגורות','ממוצע נטו R'],c.methods.flatMap(m=>m.phases.map(p=>[phases[p.phase],methods[m.method],p.closed,n(p.meanNetR)])),windows);
  add('p','עסקאות החוצות גבול בין תקופות אינן נכללות בטבלת התקופות. נדרשת בדיקה בתקופות נוספות ובעלויות שונות; אין כאן הוכחת מובהקות.',windows);
  if(c.latest.length)table(['נכס / מסלול','כניסה מדומה','יציאה מדומה','מחיר כניסה / יציאה','סיבת יציאה','נטו R'],c.latest.map(r=>[r.symbol+' · '+methods[r.method],date(r.entryAt),date(r.exitAt),n(r.entryPrice)+' / '+n(r.exitPrice),r.reason+(r.ambiguousBars?' · סדר תוך־נרי לא ודאי':''),n(r.netR)]),group);
 }
 const blockers=add('details','',box);blockers.id='entryComparisonBlockers';add('summary','מה מנע פעולה בלייב · תנאי כניסה לעומת חשבון ונתונים',blockers);
 add('p','מצב הסריקה האחרון לכל נכס, לא ספירה של עסקאות שהוחמצו. איתות בסימולציה אינו מעיד שהיה אפשר לבצע אותו בחשבון.',blockers);
 table(['נכס / זמן','תנאי כניסה או נתונים','חסם חשבון / ביצוע נוסף'],data.diagnostics.slice(0,50).map(d=>[d.symbol+' · '+date(d.at),(categories[d.category]||d.category)+' · '+d.reason,d.entryBlockReason?(categories[d.entryBlockCategory]||d.entryBlockCategory)+' · '+d.entryBlockReason:'לא נרשם בסריקה זו']),blockers);
}
