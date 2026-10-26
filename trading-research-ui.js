import {RESEARCH_SOURCES} from './lib/trading-research-sources.mjs';
const n=(v,s='')=>Number.isFinite(v)?v.toLocaleString('he-IL',{maximumFractionDigits:3})+s:'—';
const regimes={UP:'עולה',DOWN:'יורד',MIXED:'מעורב / מדשדש',UNKNOWN:'נתונים חסרים'};
const phases={development:'תצפית ראשונית · 14 ימים',validation:'בדיקה מאוחרת · 7 ימים',holdout:'בדיקה נוספת · 7 ימים',continuation:'המשך מעקב'};
const date=t=>Number.isFinite(t)?new Date(t).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}):'טרם התחיל';
export function renderTradingResearch(host,data,{document:doc=globalThis.document,modes={},variants={}}={}){
 const add=(tag,text,parent=host)=>{const e=doc.createElement(tag);e.textContent=text;parent.append(e);return e;};
 const box=add('details','');box.className='research-details';add('summary','מחקר ומעקב · תנאי שוק, עלויות ומקורות',box);
 add('p','שיטות המעקב נבדקות כתצפית. הן אינן מוסיפות הוראות מסחר או משנות את תנאי הכניסה הפעילים.',box);
 const table=(headers,rows,parent=box)=>{const wrap=add('div','',parent);wrap.className='strategy-table-wrap';const t=add('table','',wrap),h=add('tr','',add('thead','',t)),body=add('tbody','',t);headers.forEach(x=>add('th',x,h));rows.forEach(row=>{const tr=add('tr','',body);row.forEach(x=>add('td',String(x),tr));});};
 if(!data)add('p','גרסת המחקר טרם אומתה במנוע. המקורות זמינים לעיון, אך אין בכך אישור שאיסוף הנתונים פועל.',box);
 else {
  add('p','גרסה '+data.protocol.version+' · תחילת איסוף: '+date(data.startedAt)+' · '+data.retained+' תוצאות בחלון השמירה. '+(data.pruned?data.pruned+' רשומות ישנות הוצאו מהמגבלה; הטבלאות מתארות רק את החלון השמור.':''),box);
  add('p','נשמרים מומנטום של 12/48 נרות, תנודתיות ATR באחוזים, מחזור יחסי, מרחק ממחיר משוקלל מחזור של 20 נרות ויחס התנועה נטו לתנודות בדרך. במניות מדובר בנרות מסחר; פער לילה אינו נספר כשעות מסחר רציפות.',box);
  if(data.latest?.length)table(['נכס / זמן האיתות','מצב שוק','שינוי 12 / 48 נרות','ATR מהמחיר','מחזור יחסי','מרחק ממחיר משוקלל'],data.latest.map(s=>[s.symbol+' · '+date(s.at),regimes[s.regime],n(s.momentum12Pct,'%')+' / '+n(s.momentum48Pct,'%'),n(s.atrPct,'%'),n(s.volumeRatio,'×'),n(s.vwapDistancePct,'%')]));
  if(!data.groups?.length)add('p','ממתין לתוצאות של איתותים חדשים. אין השלמה מלאכותית של נתונים מהעבר.',box);
  for(const g of data.groups||[]){
   const details=add('details','',box);details.className='research-details';add('summary',(modes[g.entryMode]||g.entryMode)+' · '+(variants[g.variant]||g.variant)+' · '+g.version+' · '+g.samples+' איתותים / '+g.days+' ימים',details);
   table(['מצב שוק','איתותים','ימים','שינוי מחיר ממוצע','עלייה מרבית בסגירות','ירידה מרבית בסגירות'],g.regimes.filter(r=>r.samples).map(r=>[regimes[r.regime],r.samples,r.days,n(r.meanReturnPct,'%'),n(r.meanFavorableClosePct,'%'),n(r.meanAdverseClosePct,'%')]),details);
   add('p','טווח אי־ודאות חקרני לממוצע: '+(g.interval?n(g.interval.low,'%')+' עד '+n(g.interval.high,'%'):'טרם זמין — נדרשים לפחות 100 איתותים על פני 30 ימים שונים.')+' הדגימה משתמשת במקטעי ימים כדי לשמר חלק מהתלות בין התוצאות. אין תיקון לריבוי השוואות ואין זו הוכחת רווחיות.',details);
   table(['תקופה שנקבעה מראש','איתותים','ימים','שינוי מחיר ממוצע'],g.phases.map(p=>[phases[p.phase],p.samples,p.days,n(p.meanReturnPct,'%')]),details);
   add('p',g.embargoed+' איתותים הופרדו בגלל חפיפה לגבול בין תקופות. החלוקה בזמן אינה ניסוי מבוקר; לא נבחרת שיטה אוטומטית לפי התוצאות.',details);
   table(['עלות משוערת כוללת לקנייה ומכירה','שינוי מחיר ממוצע פחות ההנחה'],g.costStress.map(c=>[n(c.roundTripBps/100,'%'),n(c.meanReturnAfterAssumedCostPct,'%')]),details);
   add('p','תרחישי עלות בלבד, לא עמלות החשבון ולא רווח נטו. '+g.pathComplete+'/'+g.samples+' מסלולים כוללים את כל הסגירות הצפויות. קיצוני המסלול נמדדים בסגירות נרות בלבד, ללא שיא/שפל תוך־נרי או הדמיית סטופ.',details);
  }
 }
 const sources=add('details','',box);sources.className='research-details';add('summary','מקורות ושיטות · '+RESEARCH_SOURCES.length+' מקורות נבחרים',sources);
 for(const s of RESEARCH_SOURCES){const item=add('div','',sources);item.className='research-source';const link=add('a',s.title,item);link.href=s.url;link.target='_blank';link.rel='noopener noreferrer';add('p',s.type+' · '+s.application+' '+s.limit,item);}
 add('p','המקורות מספקים בסיס למדידה ולבדיקה. ספי המדדים המקומיים אינם ממצאים מוכחים של המאמרים. Sharpe, הסתברות התאמת־יתר ותשואה צפויה אינם מחושבים ללא סדרת שווי תיק ונתוני ניסויים מתאימים.',sources);
}
