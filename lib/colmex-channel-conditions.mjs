// Presentation only. Chart geometry is dynamic; the server evaluates frozen pre-breakout geometry.
import {buildColmexMarks} from './colmex-chart-marks.mjs';
import {entryReasonLabel} from './colmex-entry-reasons.mjs?v=20261104-poc';
import {colmexStrategyView} from './colmex-strategy-view.mjs?v=20261104-poc';

export const COLMEX_CHANNEL_RULES=Object.freeze([
 'תעלה: 50 נרות סגורים של 5 דקות לפני נר הפריצה, עם לפחות שתי נגיעות מאושרות למעלה ושתי נגיעות למטה. קיצון מאושר לאחר שני נרות נוספים.',
 'פריצה: הנר הקודם בתוך הגבול העליון או עליו, ומחיר הברוקר עולה מעליו בזמן הנר, ללא המתנה לסגירתו. הרגרסיה עולה והמחיר מעל המרכז שלה.',
 'מחזור: המחזור שכבר הצטבר בנר הפריצה הפתוח לפחות פי 1.5 מממוצע 20 הנרות הקודמים; מחזור כספי ממוצע של לפחות 10,000 דולר לנר.',
 'תוקף: איתות חדש שלא נוצל, לאחר הפעלת המסלול או סגירת העסקה הקודמת. תוקפו עד סוף נר הפריצה הנוכחי; כל התנאים נבדקים שוב לפני השליחה.',
 'לפני קנייה: מחיר ברוקר עדכני מעל רמת הפריצה, גבול התעלה המוקרן ומרכז הרגרסיה, ולפני יעד הרווח. פתיל שירד והתאושש אינו פוסל לבדו. נבדקים גם מזומן, מקום פנוי והוראות ההגנה לפי SETTINGS.'
]);
const number=n=>Number.isFinite(n)?n.toLocaleString('en-US',{maximumFractionDigits:6}):'—';
const time=at=>new Date(at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'});

// A position can carry an old setup. Preserve its actual trade marks, never its analysis stages.
export function colmexLiveTradeMarks(position){
 const marks=buildColmexMarks(position?{positions:{chart:position}}:null,'chart');
 return Object.fromEntries(['points','lines','cards'].map(key=>[key,marks[key]
  .filter(p=>['buy','sell','peak','stop','poc','swingPivot'].includes(p.kind))
  .map(p=>({...p,name:p.name.replace('מדומה','בחשבון')}))]));
}

export function colmexChannelConditions({channels=null,status=null,symbol='',manual=false,historical=false,now=Date.now()}={}){
 const swing=channels?.swing,regression=channels?.regression;
 const touches=key=>swing?.ready&&Number.isInteger(swing[key])?String(swing[key]):'—';
 const direction=regression?.ready?(regression.slope>0?'עולה':regression.slope<0?'יורדת':'שטוחה'):'לא זמין';
 const times=channels?.axis?[...channels.axis.keys()].filter(Number.isFinite):[];
 const measuredAt=times.length?Math.max(...times)+300000:null;
 const chartContext=manual?'נתוני CSV · תצוגה בלבד':historical?'חלון היסטורי · תצוגה בלבד':'נתוני הגרף · תצוגה דינמית';
 const chartNote=(measuredAt?'נר סגור אחרון בחישוב: '+time(measuredAt)+' · ':'')+'תעלות הרגרסיה והקיצון הן שכבת תצוגה. הכניסה החדשה נבדקת בשרת לפי מבנה השיאים והשפלים ו־POC מחושב.';
 let server='ממתין לבדיקה מתועדת במסלול התעלות עבור '+symbol+'.';
 let serverState='unavailable';
 const check=status?.checks?.[symbol],at=check?.at;
 if(manual||historical)server='אין התאמה בין חלון זה לבדיקה הנוכחית בשרת. מצב הכניסה מופיע במעקב הסריקה.';
 else if(status?.unavailable)server='מצב השרת אינו זמין כרגע; אין אישור כניסה מאומת.';
 else if(check?.entryDecisions?.primary==='poc_reclaim'&&Number.isFinite(at)&&at>0&&at<=now){
  serverState=now-at>1800000?'old':'recorded';
  server='בדיקת שרת אחרונה: '+time(at)+' · '+entryReasonLabel(check.reason||check.entryDecisions.poc?.reason||'WAIT_NEXT_CYCLE')+'.';
  if(Number.isFinite(check.poc?.value))server+=' POC: '+number(check.poc.value)+' USD.';
  if(check.entryBlockReason)server+=' '+entryReasonLabel(check.entryBlockReason)+'.';
  server+=serverState==='old'?' הבדיקה מלפני יותר מ־30 דקות.':' זו תוצאת הבדיקה המתועדת, ולא אישור כניסה בזמן הרענון.';
 }
 return {
  title:symbol+' · תנאי כניסה LONG · מבנה עולה + POC',
  route:colmexStrategyView(status).title,chartContext,chartNote,server,serverState,
  metrics:check?.entryDecisions?.primary==='poc_reclaim'&&check.poc?[["POC מחושב",Number.isFinite(check.poc.value)?number(check.poc.value):'—','אומדן לפי נפח OHLCV'],['מבנה אחרון',check.poc.swing||'ממתין','2 שיאים ו־2 שפלים עולים'],['איתות',check.poc.reclaimed?'חזר מעל POC':'ממתין לחזרה','נבדק בתוך הנר החי']]:[['נגיעות למעלה',touches('highTouches'),'לפי התעלה המוצגת'],['נגיעות למטה',touches('lowTouches'),'לפי התעלה המוצגת'],['כיוון הרגרסיה',direction,'לפי התעלה המוצגת']],
  levels:check?.poc?.pivots?.length?'POC לפי 32 רמות מחיר: '+number(check.poc.value)+' USD · שפל מבני: '+number(check.poc.structuralStop)+' USD':'אין עדיין ארבע נקודות קיצון מאושרות לחישוב POC.',
  center:'מבנה לונג: שפל עולה, שיא עולה, שפל גבוה יותר ושיא גבוה יותר; שתי נרות אישור לכל קיצון.',
  rules:[
   'השרת בוחן 50 נרות סגורים של 5 דקות לפני הנר החי; מעבר בין ימי מסחר תקינים מותר, אך חוסר נתונים בתוך יום מסחר מאפס את הרצף.',
   'נדרשים שני שפלים עולים ושני שיאים עולים, כאשר כל נקודת קיצון מאושרת לאחר שני נרות נוספים.',
   'ה־POC מחושב מפרופיל נפח משוער של המהלך מהשפל העולה האחרון לשיא שאחריו, ב־32 רמות מחיר. חלוקת נפח OHLCV היא אומדן ואינה נתוני עסקאות מלאים.',
   'הכניסה מתבצעת תוך־נר רק אם הנמוך של הנר החי הגיע ל־POC או מתחתיו והציטוט העדכני חזר מעליו. שבירה מתחת לשפל המבני האחרון פוסלת את האיתות.',
   'השרת מחשב שוב היסטוריה, מבנה, POC, ציטוט ונר חי לפני שליחת הוראת קנייה; יתרת מזומן, מקום פנוי והגנות נשארים לפי ההגדרות הקיימות.'
  ]
 };
}

export function renderColmexChannelConditions(host,options){
 if(!host)return;
 const view=colmexChannelConditions(options),doc=host.ownerDocument||document;
 const add=(parent,tag,text,cls)=>{const el=doc.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;parent.append(el);return el;};
 host.replaceChildren();
 add(host,'h3',view.title);add(host,'p',view.route,'channel-route');
 const result=add(host,'p',view.server,'channel-server-result');result.dataset.state=view.serverState;
 add(host,'h4',view.chartContext);
 const metrics=add(host,'div','','channel-condition-metrics');
 for(const [label,value,hint]of view.metrics){const cell=add(metrics,'div');add(cell,'span',label);add(cell,'strong',value);add(cell,'small',hint);}
 add(host,'p',view.levels,'channel-levels');add(host,'p',view.center,'channel-levels');
 add(host,'p',view.chartNote,'muted small');
 add(host,'h4','התנאים שהשרת בודק לפני כניסה');
 const list=add(host,'ol');for(const rule of view.rules)add(list,'li',rule);
}
