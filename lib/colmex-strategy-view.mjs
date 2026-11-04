// Describe actual server configuration; this module cannot enable trading.
export function colmexStrategyView(data){
 const c=data?.channelPrimary;
 if(!c)return {title:'מסלול כניסה · המצב אינו זמין',entry:'ממתין לאימות הגדרות האסטרטגיה מהשרת.',exit:'נתוני ההגנות אינם מאומתים כרגע.'};
 if(c.requested){
  const valid=c.enabled===true&&Number.isFinite(c.enabledAfter)&&c.enabledAfter>0;
  return {title:valid?'מסלול כניסה · מבנה עולה + POC · '+(data.enabled?'מופעל':'המסחר כבוי'):'מסלול POC נבחר · כניסות חסומות עד אימות ההפעלה',
   entry:'LONG: השרת בודק 50 נרות סגורים של 5 דקות, ומזהה רצף של שני שפלים עולים ושני שיאים עולים שאושרו לאחר שני נרות. על טווח המהלך מהשפל העולה האחרון לשיא שאחריו מחושב פרופיל נפח משוער ב־32 רמות מחיר. הכניסה נבדקת בזמן אמת: הנר הפתוח ירד ל־POC או מתחתיו, והציטוט העדכני חזר מעליו. אין המתנה לסגירת הנר. רגע לפני השליחה השרת מחשב שוב את המבנה וה־POC. חישוב נפח לפי OHLCV הוא אומדן, לא נתוני עסקאות מלאים של Fixed Range Volume Profile. נדרש איתות חדש לאחר ההפעלה.',
   exit:'הסטופ, יעד הרווח והגנת הרווח נשארים לפי SETTINGS ומדיניות הפוזיציות הקיימת. פוזיציות קודמות ממשיכות לפי מדיניותן הרשומה.'};
 }
 return {title:'מסלול התעלות כבוי · '+(data.enabled?'המסלולים הקודמים פעילים':'המסחר כבוי'),entry:'תנאי תעלת הקיצון מוצגים לעיון בלבד. מסלול התעלות אינו פעיל בשרת ולכן התצוגה אינה מאשרת כניסה לפיו.',exit:'ההגנות לפי המדיניות הרשומה לכל פוזיציה והגדרות SETTINGS.'};
}
export function renderColmexStrategy(doc,data){
 const view=colmexStrategyView(data);
 for(const[id,key]of [['colmexEntryStrategy','title'],['colmexEntryRules','entry'],['colmexExitRules','exit']]){const host=doc.getElementById(id);if(host)host.textContent=view[key];}
}
