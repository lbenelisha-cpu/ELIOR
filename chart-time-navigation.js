import {createChartViewport,candleTime} from './lib/chart-viewport.mjs?v=20261029-time-nav';

export function createChartTimeNavigation({host,onChange}){
 const viewport=createChartViewport();let current=null,frame=0;
 const notify=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;onChange();});};
 if(!host)return {view:(bars,options)=>viewport.view(bars,options)};
 host.classList.add('chart-time-navigation');
 const header=document.createElement('div');header.className='chart-time-header';
 const title=document.createElement('strong');title.textContent='חלון הזמן בגרף';
 const state=document.createElement('span');state.className='chart-time-state';header.append(title,state);
 const actions=document.createElement('div');actions.className='chart-time-actions';
 const button=(text,label,action)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.title=label;b.setAttribute('aria-label',label);b.onclick=()=>{action();notify();};actions.append(b);return b;};
 const zoomIn=button('+ הגדל','הגדל נרות והצג פרק זמן קצר יותר',()=>viewport.zoom(.5));
 const zoomOut=button('− הקטן','הקטן נרות והצג פרק זמן ארוך יותר',()=>viewport.zoom(2));
 const reset=button('תקריב אוטומטי','התאם את מספר הנרות לרוחב המסך וחזור לנרות האחרונים',()=>viewport.reset());
 const all=button('כל הטווח','הצג את כל הנרות שנטענו',()=>viewport.showAll());
 const latest=button('לנר האחרון','חזור לנרות האחרונים והמשך לעקוב אחרי עדכונים',()=>viewport.latest());
 const timeline=document.createElement('div');timeline.className='chart-time-slider';timeline.dir='ltr';
 const earlier=document.createElement('button');earlier.type='button';earlier.textContent='‹';earlier.setAttribute('aria-label','הצג נרות מוקדמים יותר');earlier.onclick=()=>{viewport.move(-Math.max(1,Math.floor(current?.size/2)));notify();};
 const range=document.createElement('input');range.type='range';range.min='0';range.max='0';range.step='1';range.value='0';range.setAttribute('aria-label','מיקום חלון הזמן בהיסטוריה');range.oninput=()=>{viewport.seek(Number(range.value));notify();};
 const later=document.createElement('button');later.type='button';later.textContent='›';later.setAttribute('aria-label','הצג נרות מאוחרים יותר');later.onclick=()=>{viewport.move(Math.max(1,Math.floor(current?.size/2)));notify();};
 timeline.append(earlier,range,later);
 const dates=document.createElement('div');dates.className='chart-time-dates';dates.dir='ltr';
 const start=document.createElement('span'),end=document.createElement('span');dates.append(start,end);
 const help=document.createElement('small');help.textContent='גרור את המחוון לצפייה בעבר. לחזרה למעקב בחר ״לנר האחרון״.';
 host.replaceChildren(header,actions,timeline,dates,help);
 const time=new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 return {view(bars,options){
  current=viewport.view(bars,options);
  const {total,size,maxStart,following}=current;
  range.max=String(maxStart);range.value=String(current.start);range.disabled=!maxStart;
  earlier.disabled=!total||current.start===0;later.disabled=!total||current.start===maxStart;
  zoomIn.disabled=size<=6;zoomOut.disabled=size>=total;all.disabled=!total;reset.disabled=!total;latest.disabled=!total||following;
  state.textContent=!total?'ממתין לנרות':(following?'הנרות האחרונים':'צפייה בעבר')+' · '+size+' מתוך '+total+' נרות';
  state.classList.toggle('is-history',!following);host.dataset.following=String(following);
  start.textContent=total?time.format(new Date(candleTime(current.bars[0]))):'—';
  end.textContent=total?time.format(new Date(candleTime(current.bars.at(-1)))):'—';
  range.setAttribute('aria-valuetext',total?start.textContent+' עד '+end.textContent:'אין נתונים');
  return current;
 }};
}
