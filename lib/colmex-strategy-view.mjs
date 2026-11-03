// Describe actual server configuration; this module cannot enable trading.
export function colmexStrategyView(data){
 const c=data?.channelPrimary;
 if(!c)return {title:'מסלול כניסה · המצב אינו זמין',entry:'ממתין לאימות הגדרות האסטרטגיה מהשרת.',exit:'נתוני ההגנות אינם מאומתים כרגע.'};
 if(c.requested){
  const valid=c.enabled===true&&Number.isFinite(c.enabledAfter)&&c.enabledAfter>0;
  return {title:valid?'מסלול כניסה · תעלת קיצון + רגרסיה · '+(data.enabled?'מופעל':'המסחר כבוי'):'מסלול התעלות נבחר · כניסות חסומות עד אימות ההפעלה',
   entry:'LONG: תעלת קיצון מ־50 נרות סגורים של 5 דקות לפני נר הפריצה, עם לפחות שתי נגיעות מאושרות בכל גבול. '+(c.waitForBreakoutClose===false?'כניסה בזמן הנר לפי מחיר הברוקר מעל הגבול העליון ומרכז רגרסיה עולה, ללא המתנה לסגירת נר הפריצה. המחזור שהצטבר בנר הפתוח לפחות פי 1.5 מממוצע 20 הנרות הקודמים.':'גרסת השרת המדווחת דורשת סגירה מעל הגבול העליון ומרכז רגרסיה עולה, ומחזור פי 1.5 מממוצע 20 הנרות הקודמים.')+' המחיר הנוכחי נבדק שוב לפני ההוראה; פתיל שירד והתאושש אינו פוסל לבדו. נדרש איתות חדש לאחר ההפעלה.',
   exit:'לעסקאות תעלה חדשות: יעד הרווח הוא גבול הפריצה ועוד רוחב התעלה שנקבע בעת האיתות. הסטופ, סף הפעלת הגנת הרווח והמרחק הנגרר לפי SETTINGS. הגנה שכבר הושגה אינה נחלשת. פוזיציות קודמות ממשיכות לפי מדיניותן הרשומה.'};
 }
 return {title:'מסלול התעלות כבוי · '+(data.enabled?'המסלולים הקודמים פעילים':'המסחר כבוי'),entry:'תנאי תעלת הקיצון מוצגים לעיון בלבד. מסלול התעלות אינו פעיל בשרת ולכן התצוגה אינה מאשרת כניסה לפיו.',exit:'ההגנות לפי המדיניות הרשומה לכל פוזיציה והגדרות SETTINGS.'};
}
export function renderColmexStrategy(doc,data){
 const view=colmexStrategyView(data);
 for(const[id,key]of [['colmexEntryStrategy','title'],['colmexEntryRules','entry'],['colmexExitRules','exit']]){const host=doc.getElementById(id);if(host)host.textContent=view[key];}
}
