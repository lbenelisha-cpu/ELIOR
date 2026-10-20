import {marketHours} from './lib/colmex-market-hours.mjs';
const box=document.getElementById('marketHoursBox'),badge=document.getElementById('marketHoursBadge'),hours=document.getElementById('marketHoursWindow'),next=document.getElementById('marketHoursNext');
const clock=t=>new Date(t).toLocaleTimeString('he-IL',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function update(){
 const s=marketHours();box.dataset.session=s.known?(s.open?'open':'closed'):'unknown';
 badge.textContent=!s.known?'לוח שעות לא זמין':s.open?'פתוח לפי לוח הבורסה':'המסחר הרגיל סגור';
 hours.textContent=s.session?`${s.open?'היום':'ביום המסחר הבא'}: ${clock(s.session.openAt)}–${clock(s.session.closeAt)} · שעון ישראל${s.session.early?' · סגירה מוקדמת':''}`:'נדרשת עדכנות לוח המסחר.';
 next.textContent=s.open?'מסחר רגיל במניות ארה״ב · ללא טרום־מסחר ואחרי־מסחר':s.nextOpenAt?'פתיחה הבאה: '+new Date(s.nextOpenAt).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem',weekday:'long',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}):'';
}
update();setInterval(update,30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});
