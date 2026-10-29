export const COLMEX_CANDIDATE_TYPES=[
 ['candidatePeak','שיא מועמד · טרם אושר','#aebcd1'],['candidateLow','שפל מועמד · טרם אושר','#aebcd1'],
 ['candidateRally','שיא התאוששות מועמד','#aebcd1'],['candidateTest','בדיקה חוזרת מועמדת','#aebcd1']
];
const candidates={SEARCH_PEAK:['candidatePeak','searchCandidate'],FIRST_LOW:['candidateLow','lowCandidate'],RALLY_HIGH:['candidateRally','highCandidate'],SECONDARY_TEST:['candidateTest','testCandidate']};
export function searchProgress(setup){
 const phase=setup.phase,entry=candidates[phase],p=entry&&setup[entry[1]],kind=entry?.[0],type=COLMEX_CANDIDATE_TYPES.find(t=>t[0]===kind);
 const candidate=p&&Number.isFinite(p.time)&&Number.isFinite(p.price)&&p.price>0?{kind,name:type[1],color:type[2],at:p.time,price:p.price,anchor:'close',provisional:true,pulse:false,id:kind+':'+p.time+':'+p.price}:null;
 const next={SEARCH_PEAK:candidate?'ממתין לנר סגור עם סגירה נמוכה מהקודמת וגבוה נמוך מהשיא המועמד.':'טרם נמצא שיא מתאים: נדרשים שני נרות ירוקים לפניו, ולאחריו נר נסיגה מאשר.',FIRST_LOW:'ממתין לנר שאינו יוצר שפל נמוך יותר וסוגר מעל הסגירה הקודמת.',RALLY_HIGH:'ממתין לנסיגה בסגירה ללא שיא גבוה חדש, כל עוד השפל הראשון נשמר.',SECONDARY_TEST:'ממתין להתאוששות בסגירה ללא שפל חדש, כל עוד השפל הראשון נשמר.',CONSOLIDATION:'נדרשים לפחות שלושה נרות דשדוש לפני שבירה מתחת לשפל הראשון (Spring).',SPRING:'Spring זוהה; בדיקות המחיר החי ו־RSI לכניסה מתבצעות בשרת.',SIGNALLED:'זוהתה חזרה מעל השפל הראשון; הכניסה בפועל כפופה לבדיקות השרת.'}[phase]||'מצב הכניסה נקבע בבדיקת השרת.';
 const stages=[['initialPeak','שיא ראשוני'],['firstLow','שפל ראשון'],['rallyHigh','שיא התאוששות'],['secondaryTest','בדיקה חוזרת'],['secondRallyHigh','התאוששות שנייה גבוהה מהראשונה'],['consolidation','דשדוש ≥3'],['springLow','Spring']].map(([key,label])=>({key,label,done:key==='consolidation'?setup.consolidationBars>=3:key==='secondRallyHigh'?setup.recoveryComparison?.passed===true:!!setup[key]}));
 return {candidate,next:setup.entryReason==='SECOND_RECOVERY_NOT_HIGHER'?'התאוששות שנייה אינה גבוהה מהראשונה; התבנית אינה מאשרת כניסה.':setup.entryReason==='WAIT_SECOND_RECOVERY_CONFIRMATION'?'ממתין לשיא התאוששות שנייה גבוה מהראשון ולאישורו בנר סגור.':next,stages,consolidationBars:setup.consolidationBars||0};
}
