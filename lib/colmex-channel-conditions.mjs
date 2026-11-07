import '../channel-entry-checklist.js?v=20261107-rollover';
// Presentation only. Chart geometry is dynamic; the server evaluates frozen pre-breakout geometry.
import {buildColmexMarks} from './colmex-chart-marks.mjs';
import {entryReasonLabel} from './colmex-entry-reasons.mjs?v=20261107-poc';
import {colmexStrategyView} from './colmex-strategy-view.mjs?v=20261107-poc';

export const COLMEX_CHANNEL_RULES=Object.freeze([
 '1 · תעלת קיצון: לפחות שתי נגיעות מאושרות בכל גבול; מחושבת מ־50 נרות סגורים של 5 דקות לפני הפריצה.',
 '3 · פריצה מעל התעלה ללונג או שבירה מתחת לתעלה לשורט מכינות את העסקה. הפרופיל נקבע בסיום נר הפריצה.',
 '4 · LONG: מהשפל בתעלה עד שיא נר הפריצה, ואז חזרה מלמעלה ל־POC. SHORT: מהשיא עד שפל נר השבירה, ואז חזרה מלמטה ל־POC.',
 '8 · דשדוש בתחילת התעלה: תחתון או אמצעי ללונג; עליון או אמצעי לשורט. אין דרישת יציאה מטווח הדשדוש.',
 'הפרופיל קבוע ונרות החזרה אינם נכללים בו. POC משוער מנפח הנרות; בדיקות ביצוע והגנות נפרדות מתנאי התבנית.'
]);
const number=n=>Number.isFinite(n)?n.toLocaleString('en-US',{maximumFractionDigits:6}):'—';
const time=at=>new Date(at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'});
function checklistSchema(policy,conditions){
 // One server policy covers both Colmex directions. A saved scan may predate
 // that policy: use it only as evidence, never to override the current labels.
 if(['CHANNEL_POC_RETEST_V1','CHANNEL_POC_RETEST_V2'].includes(policy?.version))return 'CHANNEL_POC_CONDITIONS_V1';
 if(policy?.version==='CHANNEL_PRIMARY_INTRABAR_V2')return 'CHANNEL_CONDITIONS_PARALLEL_V1';
 // No current policy/report means the requested POC rules, all unverified.
 return conditions?.version==='CHANNEL_CONDITIONS_PARALLEL_V1'?'CHANNEL_CONDITIONS_PARALLEL_V1':'CHANNEL_POC_CONDITIONS_V1';
}

// A position can carry an old setup. Preserve its actual trade marks, never its analysis stages.
export function colmexLiveTradeMarks(position){
 const marks=buildColmexMarks(position?{positions:{chart:position}}:null,'chart');
 return Object.fromEntries(['points','lines','cards'].map(key=>[key,marks[key]
  .filter(p=>['buy','sell','peak','stop','poc','swingPivot'].includes(p.kind))
  .map(p=>({...p,name:p.name.replace('מדומה','בחשבון')}))]));
}

export function colmexChannelConditions({channels=null,status=null,symbol='',manual=false,historical=false,now=Date.now(),tracker=null}={}){
 const swing=channels?.swing,regression=channels?.regression;
 const touches=key=>swing?.ready&&Number.isInteger(swing[key])?String(swing[key]):'—';
 const direction=regression?.ready?(regression.slope>0?'עולה':regression.slope<0?'יורדת':'שטוחה'):'לא זמין';
 const times=channels?.axis?[...channels.axis.keys()].filter(Number.isFinite):[];
 const measuredAt=times.length?Math.max(...times)+300000:null;
 const chartContext=manual?'נתוני CSV · תצוגה בלבד':historical?'חלון היסטורי · תצוגה בלבד':'נתוני הגרף · תצוגה דינמית';
 const chartNote=(measuredAt?'נר סגור אחרון בחישוב: '+time(measuredAt)+' · ':'')+'המדדים שייכים לתעלה המצוירת; תעלות הרגרסיה והקיצון הן שכבת תצוגה. הכניסה נבדקת בשרת לפי התעלה ופרופיל הנפח הקבוע; הרגרסיה לתצוגה בלבד.';
 let server='ממתין לבדיקה מתועדת במסלול התעלות עבור '+symbol+'.';
 let serverState='unavailable';
 const check=status?.checks?.[symbol],at=check?.at;
 if(manual||historical)server='אין התאמה בין חלון זה לבדיקה הנוכחית בשרת. מצב הכניסה מופיע במעקב הסריקה.';
 else if(status?.unavailable)server='מצב השרת אינו זמין כרגע; אין אישור כניסה מאומת.';
 else if(check?.entryDecisions?.primary==='channel_long_short'&&Number.isFinite(at)&&at>0&&at<=now){
  serverState=now-at>1800000?'old':'recorded';
  server='בדיקת שרת אחרונה: '+time(at)+' · '+entryReasonLabel(check.reason||check.entryDecisions.channel?.reason||'WAIT_NEXT_CYCLE')+'.';
  const consolidation=check.entryDecisions.channel?.consolidation;
  if(consolidation?.zone)server+=' דשדוש '+({UPPER:'עליון',LOWER:'תחתון',MIDDLE:'אמצעי'}[consolidation.zone]||'')+' · '+consolidation.bars+' נרות · הסתיים '+time(consolidation.endAt)+'.';
  if(check.entryDecisions.channel?.side)server+=' כיוון: '+check.entryDecisions.channel.side+'.';
  if(check.entryBlockReason)server+=' '+entryReasonLabel(check.entryBlockReason)+'.';
  server+=serverState==='old'?' הבדיקה מלפני יותר מ־30 דקות.':' זו תוצאת הבדיקה המתועדת, ולא אישור כניסה בזמן הרענון.';
 }
 const conditionReports=check?.entryDecisions?.channel?.conditionReports;
 const conditionViews=['LONG','SHORT'].map(side=>{
  const conditions=conditionReports?.[side];
  const input={side,symbol,marketSymbol:symbol,conditions,schemaVersion:checklistSchema(status?.channelPrimary,conditions),at,now,expiresAt:conditions?.expiresAt,
   reason:check?.entryDecisions?.channel?.directions?.[side]||check?.reason,
   transport:!manual&&!historical&&!status?.unavailable,supported:check?.entryDecisions?.primary==='channel_long_short',
   blocker:check?.entryBlockReason||null};
  const view=tracker?tracker.update(input):globalThis.LEVI_ENTRY_CHECKLIST.project(input);
  return {side,...view};
 });
 return {conditionViews,
  title:symbol+' · תנאי כניסה LONG / SHORT · תעלת קיצון ו־POC',
  route:colmexStrategyView(status).title,chartContext,chartNote,server,serverState,
  metrics:[['נגיעות למעלה',touches('highTouches'),'לפי התעלה המוצגת'],['נגיעות למטה',touches('lowTouches'),'לפי התעלה המוצגת'],['כיוון הרגרסיה',direction,'לפי התעלה המוצגת']],
  levels:'גבולות התעלה המצוירת: '+number(swing?.upper)+' / '+number(swing?.lower)+'. פריצה מכינה את העסקה; הכניסה בחזרה ל־POC הקבוע.',
  center:'מרכז הרגרסיה המצוירת: '+number(regression?.middle)+'. נתון לתצוגה בלבד, אינו תנאי כניסה.',
  rules:[...COLMEX_CHANNEL_RULES]

 };
}

const panelTrackers=new WeakMap();
export function renderColmexChannelConditions(host,options={}){
 if(!host)return;
 let tracker=panelTrackers.get(host);
 if(!tracker){tracker=globalThis.LEVI_ENTRY_CHECKLIST.createTracker({market:'COLMEX'});panelTrackers.set(host,tracker);}
 tracker.retain([options.symbol]);
 const view=colmexChannelConditions({...options,tracker}),doc=host.ownerDocument||document;
 const add=(parent,tag,text,cls)=>{const el=doc.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;parent.append(el);return el;};
 host.replaceChildren();
 add(host,'h3',view.title);add(host,'p',view.route,'channel-route');
 const result=add(host,'p',view.server,'channel-server-result');result.dataset.state=view.serverState;
 const checks=add(host,'div','','channel-parallel-checks');
 for(const result of view.conditionViews){
  const section=add(checks,'section'),count=result.status==='refreshing'?result.previousCount+'/'+result.total+' בבדיקה האחרונה · מתעדכן':result.current&&!result.dataPending?result.count+'/'+result.total+' התקיימו':'ממתין לבדיקה מלאה ועדכנית';
  add(section,'h4',result.side+' · '+count);
  const list=add(section,'ul');
  for(const row of result.rows){
   const label=['passed','previous_passed'].includes(row.state)?'✓':['waiting','previous_waiting'].includes(row.state)?'○':row.state==='blocked'?'!':'—';
   const item=add(list,'li',label+' '+row.label.replace('USDT','USD')+(row.state.startsWith('previous_')?' · מהבדיקה הקודמת':''));
   item.dataset.state=row.state;
  }
  if(result.status==='refreshing')add(section,'p','בדיקה אחרונה: '+time(result.previousAt)+'. ממתין לעדכון נתוני הנר; הסימונים הקודמים אינם אישור כניסה כעת.','channel-refresh-note');
 }
 add(host,'p','כל תנאי שניתן לחשב נבדק באותה סריקה. — מציין שחסרים נתונים לבדיקה; כניסה דורשת את כל תנאי החובה ובדיקה סופית.','muted small');
 add(host,'h4',view.chartContext);
 const metrics=add(host,'div','','channel-condition-metrics');
 for(const [label,value,hint]of view.metrics){const cell=add(metrics,'div');add(cell,'span',label);add(cell,'strong',value);add(cell,'small',hint);}
 add(host,'p',view.levels,'channel-levels');add(host,'p',view.center,'channel-levels');
 add(host,'p',view.chartNote,'muted small');
 add(host,'h4','התנאים שהשרת בודק לפני כניסה');
 const list=add(host,'ol');for(const rule of view.rules)add(list,'li',rule);
}
