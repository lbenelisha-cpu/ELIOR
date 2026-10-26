import {entryReasonLabel} from './colmex-entry-reasons.mjs';
import {regularSession} from './colmex-market-hours.mjs';
const time=at=>new Date(at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'});
const checked=(check,now)=>Number.isFinite(check?.at)&&check.at>0&&check.at<=now;
export function scanCoverage(data,now=Date.now()){
 const known=!data?.unavailable&&Array.isArray(data?.policy?.symbols),symbols=known?[...new Set(data.policy.symbols)]:[];
 const batch=data?.policy?.scanBatchSize,poll=data?.policy?.pollSeconds;
 const roundMs=Number.isFinite(batch)&&batch>0&&Number.isFinite(poll)&&poll>0?Math.ceil(symbols.length/batch)*poll*1000:null;
 const count=symbols.filter(s=>checked(data.checks?.[s],now)).length,open=regularSession(now);
 const health=!known?'unavailable':data.halt||data.lastError?'error':data.enabled!==true?'disabled':!Number.isFinite(data.lastCompletedAt)||now-data.lastCompletedAt>300000?'delayed':'running';
 const labels={unavailable:'מצב סריקת השרת אינו זמין',error:'השרת מדווח על תקלה או עצירה',disabled:'המסחר האוטומטי כבוי',delayed:'עדכון השרת מתעכב',running:open?'סריקה מדורגת בשעות המסחר':'השוק סגור · מוצגות בדיקות קודמות'};
 const summary=labels[health]+(known?' · '+count+'/'+symbols.length+' מניות עם בדיקה מתועדת':'')+(roundMs?' · '+batch+' מניות בסבב; סבב מלא כ־'+Math.ceil(roundMs/60000)+' דקות בתנאי שגרה':'');
 return {known,symbols,roundMs,count,open,health,summary,healthText:labels[health]};
}
export function stockScanStatus(symbol,data,now=Date.now(),coverage=scanCoverage(data,now)){
 if(!coverage.known)return {scanState:'unavailable',scanText:coverage.healthText,scanTitle:coverage.healthText};
 if(!coverage.symbols.includes(symbol))return {scanState:'display',scanText:'תצוגה בלבד · לא בסריקה האוטומטית',scanTitle:'הוספה לרשימת התצוגה אינה מוסיפה מניה למסחר האוטומטי'};
 const check=data.checks?.[symbol],hasCheck=checked(check,now),old=hasCheck&&coverage.open&&now-check.at>Math.max(1800000,(coverage.roundMs||0)*2);
 const state=coverage.health!=='running'?coverage.health:!hasCheck?'waiting':old?'old':coverage.open?'checked':'closed';
 const prefix=coverage.health!=='running'?coverage.healthText:!coverage.open?'השוק סגור':old?'הבדיקה מתעכבת':'במעקב השרת';
 const scanText=prefix+' · '+(hasCheck?entryReasonLabel(check.reason||check.phase||'WAIT_NEXT_CYCLE')+' · '+time(check.at):'ממתין לבדיקה ראשונה');
 return {scanState:state,scanText,scanTitle:scanText+' · זמן הבדיקה לפי שעון ישראל; מחיר ברשימה מתעדכן בנפרד'};
}
