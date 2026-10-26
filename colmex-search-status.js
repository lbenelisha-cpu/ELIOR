import {entryReasonLabel} from './lib/colmex-entry-reasons.mjs?v=20261026-quality';
const reasons={INITIAL_PEAK_REACHED:'המחיר חזר לשיא הראשוני לפני השלמת התבנית',LOW_BROKEN_BEFORE_TEST:'השפל הראשון נשבר לפני שאושרה בדיקה חוזרת',LOW_BROKEN_BEFORE_CONSOLIDATION:'השפל הראשון נשבר לפני שלב הדשדוש',LOW_BROKEN_TOO_EARLY:'השפל הראשון נשבר לפני שהושלמו שלושה נרות דשדוש',NEWER_PEAK:'זוהה שיא מקומי חדש והחיפוש עבר לתבנית עדכנית',SPRING_EXPIRED:'חלון ה־Spring הסתיים בלי כניסה',SETUP_EXPIRED:'התבנית לא הושלמה בתוך חלון החיפוש',CONFIRMATION_ENDED:'אישור התבנית הקודמת פג או נפסל'};
const time=at=>Number.isFinite(at)?new Date(at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}):'—';
const price=n=>Number.isFinite(n)?n.toLocaleString('en-US',{maximumFractionDigits:6}):'—';
const expanded=new WeakMap();
export function searchResetText(reset){
 if(!reset)return '';
 const values=reset.reason.startsWith('LOW_BROKEN')?' · שפל קודם '+price(reset.firstLow?.price)+' ← שפל בנר '+price(reset.barLow):reset.reason==='INITIAL_PEAK_REACHED'?' · שיא קודם '+price(reset.initialPeak?.price)+' ← גבוה בנר '+price(reset.barHigh):'';
 return time(reset.at)+' · '+(reasons[reset.reason]||'החיפוש התחיל מחדש')+values;
}
export function renderSearchStatus(host,diagnostic,{symbol='',check=null,position=false,manual=false,progress=null,scan=null}={}){
 if(!host)return;host.replaceChildren();
 const add=(tag,text,cls)=>{const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;host.append(el);return el;};
 add('strong',symbol+' · '+(manual?'תצוגה ידנית':position?'פוזיציה פתוחה · מוצגות נקודות העסקה':diagnostic?'חיפוש נוכחי: '+entryReasonLabel(diagnostic.phase):'ממתין לנרות לניתוח'));
 if(!manual&&scan)add('p',scan.scanText,'search-coverage');
 if(!manual&&!position&&progress){
  add('p',progress.next,'search-next');
  add('small','ניתוח הגרף לפי נר סגור: '+time(diagnostic?.dataAt)+' · מועמד אינו נקודה מאושרת ואינו אישור קנייה.');
  const details=add('details','','search-progress'),summary=document.createElement('summary'),steps=document.createElement('ol');
  summary.textContent='שלבי וואיקוף · '+progress.stages.filter(s=>s.done).length+'/'+progress.stages.length+' זוהו';details.append(summary,steps);
  details.open=expanded.get(host)?.symbol===symbol&&expanded.get(host).open===true;
  details.ontoggle=()=>expanded.set(host,{symbol,open:details.open});
  for(const step of progress.stages){const item=document.createElement('li');item.className=step.done?'complete':'pending';item.textContent=(step.done?'✓ ':'○ ')+step.label+(step.key==='consolidation'?' · '+progress.consolidationBars+' נרות':'')+(step.done?' · זוהה':' · ממתין');steps.append(item);}
  const note=document.createElement('small');note.textContent='מסלול גל מוקדם נבדק בנפרד בשרת ואינו מחייב השלמת וואיקוף. בדיקת השרת כוללת גם מחיר עדכני, תנאי הכניסה, מזומן, מקום לפוזיציה והגנות.';details.append(note);
 }
 if(!manual&&!position&&diagnostic?.lastReset)add('p','למה הסימונים הקודמים התחלפו? '+searchResetText(diagnostic.lastReset),'search-reset');
 if(!manual&&check)add('p','בדיקת שרת אחרונה: '+time(check.at)+' · '+entryReasonLabel(check.reason)+(Number.isFinite(check.entryRsi)?' · RSI '+check.entryRsi.toFixed(2):''),'search-server-check');
 if(!manual&&check?.quality){const q=check.quality;add('p','תנאי איכות בבדיקה: '+(q.confirmed?'נר אישור זוהה':'ממתין לנר אישור')+' · מגמה: '+(!q.trend?.ready?'חסרים נתונים':q.trend.blocked?'חוסמת קנייה':'אינה חוסמת')+' · יחס מחזור: '+(Number.isFinite(q.volume?.ratio)?q.volume.ratio.toFixed(2)+'×':'לא זמין')+' · ATR: '+price(q.atr),'search-quality');}
 if(!manual&&!position)add('small','הסבר האיפוס משוחזר מהנרות הזמינים. נקודות שנפסלו יוצאות מהחיפוש הפעיל; זיהוי שיא ושפל לבדם אינו אישור קנייה.');
}
