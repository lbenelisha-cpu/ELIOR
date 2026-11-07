// Describe actual server configuration; this module cannot enable trading.
export function colmexStrategyView(data){
 const c=data?.channelPrimary;
 if(!c)return {title:'מסלול כניסה · המצב אינו זמין',entry:'ממתין לאימות הגדרות האסטרטגיה מהשרת.',exit:'נתוני ההגנות אינם מאומתים כרגע.'};
 if(c.requested&&!['CHANNEL_POC_RETEST_V1','CHANNEL_POC_RETEST_V2'].includes(c.version))return {title:'מסלול התעלות הקודם · עדכון POC טרם אומת',entry:'יש להשלים את עדכון השרת. רשימת הבדיקה מציגה את תנאי הגרסה הפעילה.',exit:'הגנות הפוזיציות לפי המדיניות הרשומה והגדרות SETTINGS.'};
 if(c.requested){
  const valid=c.enabled===true&&Number.isFinite(c.enabledAfter)&&c.enabledAfter>0;
  return {title:valid?'מסלול כניסה · תעלת קיצון + POC · LONG / SHORT · '+(data.enabled?'מופעל':'המסחר כבוי'):'מסלול התעלות נבחר · כניסות חסומות עד אימות ההפעלה',
   entry:'ארבעה תנאים: תעלה עם שתי נגיעות בכל גבול; דשדוש בתחילת התעלה; פריצה או שבירה; חזרה ל־POC הקבוע. LONG: מהשפל בתעלה עד שיא נר הפריצה, וכניסה בחזרה מלמעלה ל־POC. SHORT: מהשיא עד שפל נר השבירה, וכניסה בחזרה מלמטה ל־POC. הפרופיל מוקפא בסיום נר הפריצה; המחיר בנר החזרה נבדק בזמן אמת.',
   consolidation:'הדשדוש כולל את נקודת העיגון הראשונה של התעלה: תחתון ל־LONG, עליון ל־SHORT ואמצעי לשני הכיוונים. רגרסיה לתצוגה בלבד; אין סף מחזור או נזילות. POC משוער מחלוקת נפח הנרות לרמות מחיר.',
   exit:'יעד LONG הוא הגבול העליון ועוד רוחב התעלה; יעד SHORT הוא הגבול התחתון פחות רוחב התעלה. הסטופ וההגנה הנגררת לפי SETTINGS, בכיוון המתאים לפוזיציה. פוזיציות קודמות ממשיכות לפי מדיניותן הרשומה.'};
 }
 return {title:'מסלול התעלות כבוי · '+(data.enabled?'המסלולים הקודמים פעילים':'המסחר כבוי'),entry:'תנאי תעלת הקיצון מוצגים לעיון בלבד. מסלול התעלות אינו פעיל בשרת ולכן התצוגה אינה מאשרת כניסה לפיו.',exit:'ההגנות לפי המדיניות הרשומה לכל פוזיציה והגדרות SETTINGS.'};
}
export function renderColmexStrategy(doc,data){
 const view=colmexStrategyView(data);
 for(const[id,key]of [['colmexEntryStrategy','title'],['colmexEntryRules','entry'],['colmexExitRules','exit']]){const host=doc.getElementById(id);if(host)host.textContent=view[key]+(key==='entry'&&view.consolidation?' '+view.consolidation:'');}
}
