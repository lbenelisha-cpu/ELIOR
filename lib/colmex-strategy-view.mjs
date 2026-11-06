// Describe actual server configuration; this module cannot enable trading.
export function colmexStrategyView(data){
 const c=data?.channelPrimary;
 if(!c)return {title:'מסלול כניסה · המצב אינו זמין',entry:'ממתין לאימות הגדרות האסטרטגיה מהשרת.',exit:'נתוני ההגנות אינם מאומתים כרגע.'};
 if(c.requested){
  const valid=c.enabled===true&&Number.isFinite(c.enabledAfter)&&c.enabledAfter>0;
  return {title:valid?'מסלול כניסה · תעלת קיצון + רגרסיה · LONG / SHORT · '+(data.enabled?'מופעל':'המסחר כבוי'):'מסלול התעלות נבחר · כניסות חסומות עד אימות ההפעלה',
   entry:'50 נרות סגורים של 5 דקות ותעלת קיצון עם שתי נגיעות מאושרות בכל גבול. LONG: מחיר Bid מעל הגבול העליון ומרכז רגרסיה עולה. SHORT: מחיר Ask מתחת לגבול התחתון ומרכז רגרסיה יורדת. המחזור המצטבר בנר הפתוח לפחות פי 1.5 מממוצע 20 הנרות הקודמים, ומחזור כספי ממוצע לפחות 10,000 דולר לנר. הכניסה תוך־נר, ללא המתנה לסגירה. נדרש איתות חדש שלא נוצל, וכל התנאים נבדקים שוב לפני השליחה.',
   consolidation:c.consolidationPolicy?.version==='CHANNEL_CONSOLIDATION_V1'?'דשדוש לפני הכניסה: לפחות 3 נרות סגורים בטווח צר. עליון מתאים ל־SHORT, תחתון ל־LONG, ואמצעי מאפשר את שני הכיוונים. הדשדוש יכול להיות בכל שלב בתעלה; נדרשת יציאה ממנו בכיוון העסקה וכל תנאי הכניסה הקיימים.':null,
   exit:'יעד LONG הוא הגבול העליון ועוד רוחב התעלה; יעד SHORT הוא הגבול התחתון פחות רוחב התעלה. הסטופ וההגנה הנגררת לפי SETTINGS, בכיוון המתאים לפוזיציה. פוזיציות קודמות ממשיכות לפי מדיניותן הרשומה.'};
 }
 return {title:'מסלול התעלות כבוי · '+(data.enabled?'המסלולים הקודמים פעילים':'המסחר כבוי'),entry:'תנאי תעלת הקיצון מוצגים לעיון בלבד. מסלול התעלות אינו פעיל בשרת ולכן התצוגה אינה מאשרת כניסה לפיו.',exit:'ההגנות לפי המדיניות הרשומה לכל פוזיציה והגדרות SETTINGS.'};
}
export function renderColmexStrategy(doc,data){
 const view=colmexStrategyView(data);
 for(const[id,key]of [['colmexEntryStrategy','title'],['colmexEntryRules','entry'],['colmexExitRules','exit']]){const host=doc.getElementById(id);if(host)host.textContent=view[key]+(key==='entry'&&view.consolidation?' '+view.consolidation:'');}
}
