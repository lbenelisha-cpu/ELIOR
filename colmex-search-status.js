import {entryReasonLabel} from './lib/colmex-entry-reasons.mjs?v=20261026-entry-fix';
const reasons={INITIAL_PEAK_REACHED:'המחיר חזר לשיא הראשוני לפני השלמת התבנית',LOW_BROKEN_BEFORE_TEST:'השפל הראשון נשבר לפני שאושרה בדיקה חוזרת',LOW_BROKEN_BEFORE_CONSOLIDATION:'השפל הראשון נשבר לפני שלב הדשדוש',LOW_BROKEN_TOO_EARLY:'השפל הראשון נשבר לפני שהושלמו שלושה נרות דשדוש',NEWER_PEAK:'זוהה שיא מקומי חדש והחיפוש עבר לתבנית עדכנית',SPRING_EXPIRED:'חלון ה־Spring הסתיים בלי כניסה',SETUP_EXPIRED:'התבנית לא הושלמה בתוך חלון החיפוש',CONFIRMATION_ENDED:'אישור התבנית הקודמת פג או נפסל'};
const time=at=>Number.isFinite(at)?new Date(at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}):'—';
const price=n=>Number.isFinite(n)?n.toLocaleString('en-US',{maximumFractionDigits:6}):'—';
export function searchResetText(reset){
 if(!reset)return '';
 const values=reset.reason.startsWith('LOW_BROKEN')?' · שפל קודם '+price(reset.firstLow?.price)+' ← שפל בנר '+price(reset.barLow):reset.reason==='INITIAL_PEAK_REACHED'?' · שיא קודם '+price(reset.initialPeak?.price)+' ← גבוה בנר '+price(reset.barHigh):'';
 return time(reset.at)+' · '+(reasons[reset.reason]||'החיפוש התחיל מחדש')+values;
}
export function renderSearchStatus(host,diagnostic,{symbol='',check=null,position=false,manual=false}={}){
 if(!host)return;host.replaceChildren();
 const add=(tag,text,cls)=>{const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;host.append(el);return el;};
 add('strong',symbol+' · '+(manual?'תצוגה ידנית':position?'פוזיציה פתוחה · מוצגות נקודות העסקה':diagnostic?'חיפוש נוכחי: '+entryReasonLabel(diagnostic.phase):'ממתין לנרות לניתוח'));
 if(!manual&&!position&&diagnostic?.lastReset)add('p','למה הסימונים הקודמים התחלפו? '+searchResetText(diagnostic.lastReset),'search-reset');
 if(!manual&&check)add('p','בדיקת שרת אחרונה: '+time(check.at)+' · '+entryReasonLabel(check.reason)+(Number.isFinite(check.entryRsi)?' · RSI '+check.entryRsi.toFixed(2):''),'search-server-check');
 if(!manual&&!position)add('small','הסבר האיפוס משוחזר מהנרות הזמינים. נקודות שנפסלו יוצאות מהחיפוש הפעיל; זיהוי שיא ושפל לבדם אינו אישור קנייה.');
}
