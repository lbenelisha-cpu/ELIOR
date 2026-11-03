// Presentation only. Chart geometry is dynamic; the server evaluates frozen pre-breakout geometry.
import {buildColmexMarks} from './colmex-chart-marks.mjs';
import {entryReasonLabel} from './colmex-entry-reasons.mjs?v=20261103-intrabar';
import {colmexStrategyView} from './colmex-strategy-view.mjs?v=20261103-intrabar';

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
  .filter(p=>['buy','sell','peak','stop'].includes(p.kind))
  .map(p=>({...p,name:p.name.replace('מדומה','בחשבון')}))]));
}

export function colmexChannelConditions({channels=null,status=null,symbol='',manual=false,historical=false,now=Date.now()}={}){
 const swing=channels?.swing,regression=channels?.regression;
 const touches=key=>swing?.ready&&Number.isInteger(swing[key])?String(swing[key]):'—';
 const direction=regression?.ready?(regression.slope>0?'עולה':regression.slope<0?'יורדת':'שטוחה'):'לא זמין';
 const times=channels?.axis?[...channels.axis.keys()].filter(Number.isFinite):[];
 const measuredAt=times.length?Math.max(...times)+300000:null;
 const chartContext=manual?'נתוני CSV · תצוגה בלבד':historical?'חלון היסטורי · תצוגה בלבד':'נתוני הגרף · תצוגה דינמית';
 const chartNote=(measuredAt?'נר סגור אחרון בחישוב: '+time(measuredAt)+' · ':'')+'ספירת הנגיעות והגבולות כאן שייכים לתעלה המצוירת. הכניסה נבדקת בשרת מול 50 הנרות שלפני נר הפריצה.';
 let server='ממתין לבדיקה מתועדת במסלול התעלות עבור '+symbol+'.';
 let serverState='unavailable';
 const check=status?.checks?.[symbol],at=check?.at;
 if(manual||historical)server='אין התאמה בין חלון זה לבדיקה הנוכחית בשרת. מצב הכניסה מופיע במעקב הסריקה.';
 else if(status?.unavailable)server='מצב השרת אינו זמין כרגע; אין אישור כניסה מאומת.';
 else if(check?.entryDecisions?.primary==='channel_breakout'&&Number.isFinite(at)&&at>0&&at<=now){
  serverState=now-at>1800000?'old':'recorded';
  server='בדיקת שרת אחרונה: '+time(at)+' · '+entryReasonLabel(check.reason||check.entryDecisions.channel?.reason||'WAIT_NEXT_CYCLE')+'.';
  if(check.entryBlockReason)server+=' '+entryReasonLabel(check.entryBlockReason)+'.';
  server+=serverState==='old'?' הבדיקה מלפני יותר מ־30 דקות.':' זו תוצאת הבדיקה המתועדת, ולא אישור כניסה בזמן הרענון.';
 }
 return {
  title:symbol+' · תנאי כניסה LONG · תעלת קיצון + רגרסיה',
  route:colmexStrategyView(status).title,chartContext,chartNote,server,serverState,
  metrics:[['נגיעות למעלה',touches('highTouches'),'נדרשות לפחות 2'],['נגיעות למטה',touches('lowTouches'),'נדרשות לפחות 2'],['כיוון הרגרסיה',direction,'ל־LONG נדרשת עלייה']],
  levels:swing?.ready?'גבול עליון בגרף: '+number(swing.upper)+' · גבול תחתון: '+number(swing.lower)+' USD':'אין כרגע תעלת קיצון תקפה בחלון המוצג.',
  center:regression?.ready?'מרכז הרגרסיה בגרף: '+number(regression.middle)+' USD':'נדרשים 50 נרות סגורים ורציפים של 5 דקות לחישוב הרגרסיה.',
  rules:status?.channelPrimary&&status.channelPrimary.waitForBreakoutClose!==false?COLMEX_CHANNEL_RULES.map((r,i)=>i===1?'פריצה: גרסת השרת המדווחת עדיין דורשת נר סגור מעל הגבול העליון ומרכז רגרסיה עולה.':i===2?'מחזור: נר הפריצה הסגור לפחות פי 1.5 מממוצע 20 הקודמים; מחזור כספי ממוצע של לפחות 10,000 דולר לנר.':i===3?'תוקף: בגרסת השרת המדווחת עד 5 דקות מסגירת נר הפריצה.':r):COLMEX_CHANNEL_RULES
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
