import './channel-poc-model.js?v=20261107-poc';
import {drawPocModel} from './channel-poc-overlay.js?v=20261107-poc-v2';
const NS='http://www.w3.org/2000/svg';
const PROFILE_BINS=32;
const fmt=value=>Number(value).toLocaleString('en-US',{maximumSignificantDigits:8});
const storageKey=(symbol,interval)=>'levi-frvp-v1:'+symbol+':'+interval;

export function calculateFixedRangeProfile(bars,bins=PROFILE_BINS){
 return globalThis.LEVI_CHANNEL_POC.profile(bars,bins);
}

export function createFixedRangeVolumeProfile({host,toolbarHost}){
 if(!host||!toolbarHost)return {update(){},clear(){}};
 host.classList.add('frvp-host');
 const tools=document.createElement('div');tools.className='frvp-controls';
 const select=document.createElement('button');select.type='button';select.textContent='Fixed Range Volume Profile · בחר טווח';select.setAttribute('aria-pressed','false');
 const clear=document.createElement('button');clear.type='button';clear.textContent='נקה טווח POC';clear.hidden=true;
 const status=document.createElement('span');status.className='frvp-status';status.setAttribute('role','status');
 const automatic=document.createElement('button');automatic.type='button';automatic.textContent='POC האיתות · אוטומטי';automatic.setAttribute('aria-pressed','true');
 const sideChoice=document.createElement('select');sideChoice.setAttribute('aria-label','כיוון פרופיל הנפח');for(const v of ['LONG','SHORT']){const option=document.createElement('option');option.value=v;option.textContent=v;sideChoice.append(option);}
 tools.append(automatic,sideChoice,select,clear,status);toolbarHost.append(tools);
 const svg=document.createElementNS(NS,'svg');svg.classList.add('frvp-overlay');svg.setAttribute('aria-label','Fixed Range Volume Profile · פרופיל נפח ונקודת POC');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('viewBox','0 0 1 1');host.append(svg);
 let config=null,range=null,draft=null,choosing=false,auto=true;
 automatic.onclick=()=>{auto=true;choosing=false;draft=null;automatic.setAttribute('aria-pressed','true');select.setAttribute('aria-pressed','false');draw();config?.onModeChange?.();};
 sideChoice.onchange=()=>{auto=true;draw();};
 function persist(){try{if(range&&config)localStorage.setItem(storageKey(config.symbol,config.interval),JSON.stringify(range));}catch{}}
 function loadRange(){try{range=JSON.parse(localStorage.getItem(storageKey(config.symbol,config.interval))||'null');}catch{range=null;}}
 function draw(){
  if(!config)return;if(!svg.isConnected)host.append(svg);const {width,height,bars,bounds,x,y}=config;svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.replaceChildren();svg.dataset.mode=choosing?'select':'view';
  automatic.setAttribute('aria-pressed',String(auto));
  sideChoice.hidden=!config.models?.SHORT;
  if(auto){
   clear.hidden=true;
   const model=config.models?.[sideChoice.value]||config.models?.LONG||config.models?.SHORT;
   if(model&&drawPocModel(svg,config,model))status.textContent=model.side+' · POC משוער '+fmt(model.profile.poc)+' · טווח A–B קבוע לפי האיתות · נפח הנרות מחולק לאורך High–Low; הרגרסיה לתצוגה בלבד.';
   else status.textContent='ממתין לתעלה, דשדוש התחלתי ופריצה לקיבוע פרופיל הנפח. אפשר לבחור טווח ידני לתצוגה.';
   return;
  }
  if(choosing){status.textContent='גרור על הגרף מנר התחלה לנר סיום כדי לחשב את הפרופיל.';}
  if(!range){clear.hidden=true;return;}
  const first=bars.findIndex(b=>Number(b.time)===Number(range.start)),last=bars.findIndex(b=>Number(b.time)===Number(range.end));
  if(first<0||last<0){clear.hidden=false;status.textContent='הטווח שנבחר מחוץ לחלון הגרף הנוכחי. הזז/הגדל את התצוגה כדי לראותו.';return;}
  const from=Math.min(first,last),to=Math.max(first,last),profile=calculateFixedRangeProfile(bars.slice(from,to+1));clear.hidden=false;
  if(!profile){status.textContent='אין נתוני מחזור זמינים בטווח שנבחר.';return;}
  const left=x(from)-((bounds.right-bounds.left)/bars.length)*.45,right=x(to)+((bounds.right-bounds.left)/bars.length)*.45;
  const group=document.createElementNS(NS,'g');group.classList.add('frvp-profile');svg.append(group);
  const shade=document.createElementNS(NS,'rect');for(const [k,v]of Object.entries({x:left,y:bounds.top,width:right-left,height:bounds.bottom-bounds.top,fill:'#ffd84d','fill-opacity':'.045',stroke:'#f5cc4b','stroke-dasharray':'5 4'}))shade.setAttribute(k,v);group.append(shade);
  const maxWidth=Math.min(140,Math.max(42,(bounds.right-bounds.left)*.2)),barHeight=Math.max(1,Math.abs(y(profile.low)-y(profile.low+profile.step)));
  profile.volumes.forEach((volume,i)=>{if(volume<=0)return;const center=profile.low+(i+.5)*profile.step,yy=y(center),w=maxWidth*volume/profile.max,rect=document.createElementNS(NS,'rect');for(const [k,v]of Object.entries({x:right-w,y:yy-barHeight*.45,width:w,height:barHeight*.9,fill:i===profile.volumes.indexOf(profile.max)?'#ffe066':'#5ec7e8','fill-opacity':i===profile.volumes.indexOf(profile.max)?'.9':'.55'}))rect.setAttribute(k,v);group.append(rect);});
  const py=y(profile.poc),line=document.createElementNS(NS,'line');for(const [k,v]of Object.entries({x1:bounds.left,y1:py,x2:bounds.right,y2:py,stroke:'#ffe066','stroke-width':2,'stroke-dasharray':'8 4'}))line.setAttribute(k,v);group.append(line);
  const label=document.createElementNS(NS,'text');for(const [k,v]of Object.entries({x:bounds.right-5,y:Math.max(bounds.top+14,py-7),fill:'#ffe066','font-size':12,'font-weight':'bold','text-anchor':'end',stroke:'#08111f','stroke-width':3,'paint-order':'stroke'}))label.setAttribute(k,v);label.textContent='POC · '+fmt(profile.poc);group.append(label);
  status.textContent='POC משוער: '+fmt(profile.poc)+' · '+(to-from+1)+' נרות · 32 רמות מחיר. החישוב מחלק את נפח כל נר לאורך טווח ה־High–Low שלו.';
  if(draft){const a=x(Math.min(draft.a,draft.b)),b=x(Math.max(draft.a,draft.b)),mark=document.createElementNS(NS,'rect');for(const [k,v]of Object.entries({x:a,y:bounds.top,width:Math.max(1,b-a),height:bounds.bottom-bounds.top,fill:'#ffd84d','fill-opacity':'.12',stroke:'#ffe066','stroke-dasharray':'4 3'}))mark.setAttribute(k,v);svg.append(mark);}
 }
 select.onclick=()=>{auto=false;choosing=!choosing;draft=null;select.setAttribute('aria-pressed',String(choosing));select.textContent=choosing?'בחר טווח · גרור על הגרף':'Fixed Range Volume Profile · בחר טווח';draw();config?.onModeChange?.();};
 clear.onclick=()=>{range=null;draft=null;clear.hidden=true;if(config)try{localStorage.removeItem(storageKey(config.symbol,config.interval));}catch{}status.textContent='טווח ה־POC נוקה.';draw();};
 const point=e=>{const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const q=p.matrixTransform(svg.getScreenCTM().inverse());return Math.max(0,Math.min(config.bars.length-1,Math.round((q.x-config.bounds.left)/((config.bounds.right-config.bounds.left)/config.bars.length)-.5)));};
 svg.addEventListener('pointerdown',e=>{if(!choosing||!config||e.button!==0)return;e.preventDefault();e.stopPropagation();const i=point(e);draft={a:i,b:i};svg.setPointerCapture(e.pointerId);draw();});
 svg.addEventListener('pointermove',e=>{if(!draft||!config)return;draft.b=point(e);draw();});
 svg.addEventListener('pointerup',e=>{if(!draft||!config)return;e.preventDefault();e.stopPropagation();const d=draft;draft=null;if(Math.abs(d.b-d.a)<1){status.textContent='בחר לפחות שני נרות בטווח.';draw();return;}range={start:Number(config.bars[Math.min(d.a,d.b)].time),end:Number(config.bars[Math.max(d.a,d.b)].time)};choosing=false;select.setAttribute('aria-pressed','false');select.textContent='Fixed Range Volume Profile · שנה טווח';persist();draw();});
 return {isAutomatic:()=>auto,update(next){if(!next?.bars?.length)return;const key=next.symbol+':'+next.interval;if(!config||key!==config.symbol+':'+config.interval){config={...next};loadRange();}else config={...next};draw();},clear(){config=null;range=null;draft=null;svg.replaceChildren();status.textContent='ממתין לנרות';}};
}
