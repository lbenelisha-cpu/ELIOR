// Display calendar only. Source: https://www.nyse.com/trade/hours-calendars
// Official published 2026–2028 core equity sessions; unscheduled halts are not a calendar signal.
export const CALENDAR_SOURCE='https://www.nyse.com/trade/hours-calendars';
const holidays=new Set([
 '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
 '2027-01-01','2027-01-18','2027-02-15','2027-03-26','2027-05-31','2027-06-18','2027-07-05','2027-09-06','2027-11-25','2027-12-24',
 '2028-01-17','2028-02-21','2028-04-14','2028-05-29','2028-06-19','2028-07-04','2028-09-04','2028-11-23','2028-12-25'
]);
const early=new Set(['2026-11-27','2026-12-24','2027-11-26','2028-07-03','2028-11-24']);
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const parts=t=>Object.fromEntries(formatter.formatToParts(new Date(t)).map(p=>[p.type,p.value]));
const dayKey=p=>`${p.year}-${p.month}-${p.day}`;
function instant(day,minutes){
 const [y,m,d]=day.split('-').map(Number),anchor=Date.UTC(y,m-1,d,12),p=parts(anchor);
 const offset=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute)-anchor;
 return Date.UTC(y,m-1,d,Math.floor(minutes/60),minutes%60)-offset;
}
export function equitySession(day){
 const year=Number(day.slice(0,4));if(year<2026||year>2028)return {known:false};
 const weekday=new Date(day+'T12:00:00Z').getUTCDay();
 if(weekday===0||weekday===6)return {known:true,closed:true,reason:'WEEKEND'};
 if(holidays.has(day))return {known:true,closed:true,reason:'HOLIDAY'};
 return {known:true,closed:false,openAt:instant(day,570),closeAt:instant(day,early.has(day)?780:960),early:early.has(day)};
}
export function marketHours(now=Date.now()){
 const day=dayKey(parts(now)),today=equitySession(day);
 if(!today.known)return {known:false,open:false};
 const open=!today.closed&&now>=today.openAt&&now<today.closeAt;
 if(open)return {...today,open:true,session:today};
 for(let i=0;i<15;i++){
  const date=new Date(Date.parse(day+'T12:00:00Z')+i*86400000).toISOString().slice(0,10),session=equitySession(date);
  if(session.known&&!session.closed&&session.openAt>now)return {...today,open:false,nextOpenAt:session.openAt,session};
 }
 return {...today,open:false,session:null};
}
