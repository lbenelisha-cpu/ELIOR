const NS='http://www.w3.org/2000/svg';
const PROFILE_BINS=32;
const fmt=value=>Number(value).toLocaleString('en-US',{maximumSignificantDigits:8});
const storageKey=(symbol,interval)=>'levi-frvp-v1:'+symbol+':'+interval;

export function calculateFixedRangeProfile(bars,bins=PROFILE_BINS){
 const rows=(Array.isArray(bars)?bars:[]).filter(b=>[b.high,b.low,b.volume].every(v=>Number.isFinite(Number(v)))&&Number(b.high)>=Number(b.low)&&Number(b.volume)>=0);
 if(!rows.length||!rows.some(b=>Number(b.volume)>0))return null;
 const low=Math.min(...rows.map(b=>Number(b.low))),high=Math.max(...rows.map(b=>Number(b.high))),step=(high-low)/bins;
 if(!(step>0))return null;
 const volumes=Array(bins).fill(0);
 for(const bar of rows){const a=Number(bar.low),z=Number(bar.high),v=Number(bar.volume);if(z===a){volumes[Math.min(bins-1,Math.max(0,Math.floor((a-low)/step)))]+=v;continue;}for(let i=0;i<bins;i++){const lo=low+i*step,hi=i===bins-1?high:lo+step;volumes[i]+=v*Math.max(0,Math.min(hi,z)-Math.max(lo,a))/(z-a);}}
 const max=Math.max(...volumes),index=volumes.indexOf(max);
 return {low,high,step,bins,volumes,max,poc:low+(index+.5)*step};
}

export function createFixedRangeVolumeProfile({host,toolbarHost}){
 if(!host||!toolbarHost)return {update(){},clear(){}};
 host.classList.add('frvp-host');
 const tools=document.createElement('div');tools.className='frvp-controls';
 const select=document.createElement('button');select.type='button';select.textContent='Fixed Range Volume Profile · בחר טווח';select.setAttribute('aria-pressed','false');
 const clear=document.createElement('button');clear.type='button';clear.textContent='נקה טווח POC';clear.hidden=true;
 const status=document.createElement('span');status.className='frvp-status';status.setAttribute('role','status');
 tools.append(select,clear,status);toolbarHost.append(tools);
 const svg=document.createElementNS(NS,'svg');svg.classList.add('frvp-overlay');svg.setAttribute('aria-label','Fixed Range Volume Profile · פרופיל נפח ונקודת POC');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('viewBox','0 0 1 1');host.append(svg);
 let config=null,range=null,draft=null,choosing=false;
 function persist(){try{if(range&&config)localStorage.setItem(storageKey(config.symbol,config.interval),JSON.stringify(range));}catch{}}
 function loadRange(){try{range=JSON.parse(localStorage.getItem(storageKey(config.symbol,config.interval))||'null');}catch{range=null;}}
 function draw(){
  if(!config)return;if(!svg.isConnected)host.append(svg);const {width,height,bars,bounds,x,y}=config;svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.replaceChildren();svg.dataset.mode=choosing?'select':'view';
  if(choosing){status.textContent='גרור על הגרף מנר התחלה לנר סיום כדי לחשב את הפרופיל.';}
  if(!range){clear.hidden=true;return;}
  const first=bars.findIndex(b=>Number(b.time)===Number(range.start)),last=bars.findIndex(b=>Number(b.time)===Number(range.end));
  if(first<0||last<0){clear.hidden=false;status.textContent='הטווח שנבחר מחוץ לחלון הגרף הנוכחי. הזז/הגדל את התצוגה כדי לראותו.';return;}
  const from=Math.min(first,last),to=Math.max(first,last),profile=calculateFixedRangeProfile(bars.slice(from,to+1));clear.hidden=false;
  if(!profile){status.textContent='אין נתוני מחזור זמינים בטווח שנבחר.';return;}
  const left=x(from)-((bounds.right-bounds.left)/bars.length)*.45,right=x(to)+((bounds.right-bounds.left)/bars.length)*.45;
  const group=document.createElementNS(NS,'g');group.classList.add('frvp-profile');svg.append(group);
  const shade=document.createElementNS(NS,'rect');for(const [k,v]of Object.entries({x:left,y:bounds.top,width:right-left,height:bounds.bottom-bounds.top,fill:'#ffd84d','fill-opacity':'.045',stroke:'#f5cc4b','stroke-dasharray':'5 4'}))shade.setAttribute(k,v);group.append(shade);
  const maxWidth=Math.min(140,Math.max(42,(bounds.right-bounds.left)*.2)),barHeight=Math.max(1,(bounds.bottom-bounds.top)/profile.bins);
  profile.volumes.forEach((volume,i)=>{if(volume<=0)return;const center=profile.low+(i+.5)*profile.step,yy=y(center),w=maxWidth*volume/profile.max,rect=document.createElementNS(NS,'rect');for(const [k,v]of Object.entries({x:right-w,y:yy-barHeight*.45,width:w,height:barHeight*.9,fill:i===profile.volumes.indexOf(profile.max)?'#ffe066':'#5ec7e8','fill-opacity':i===profile.volumes.indexOf(profile.max)?'.9':'.55'}))rect.setAttribute(k,v);group.append(rect);});
  const py=y(profile.poc),line=document.createElementNS(NS,'line');for(const [k,v]of Object.entries({x1:bounds.left,y1:py,x2:bounds.right,y2:py,stroke:'#ffe066','stroke-width':2,'stroke-dasharray':'8 4'}))line.setAttribute(k,v);group.append(line);
  const label=document.createElementNS(NS,'text');for(const [k,v]of Object.entries({x:bounds.right-5,y:Math.max(bounds.top+14,py-7),fill:'#ffe066','font-size':12,'font-weight':'bold','text-anchor':'end',stroke:'#08111f','stroke-width':3,'paint-order':'stroke'}))label.setAttribute(k,v);label.textContent='POC · '+fmt(profile.poc);group.append(label);
  status.textContent='POC משוער: '+fmt(profile.poc)+' · '+(to-from+1)+' נרות · 32 רמות מחיר. החישוב מחלק את נפח כל נר לאורך טווח ה־High–Low שלו.';
  if(draft){const a=x(Math.min(draft.a,draft.b)),b=x(Math.max(draft.a,draft.b)),mark=document.createElementNS(NS,'rect');for(const [k,v]of Object.entries({x:a,y:bounds.top,width:Math.max(1,b-a),height:bounds.bottom-bounds.top,fill:'#ffd84d','fill-opacity':'.12',stroke:'#ffe066','stroke-dasharray':'4 3'}))mark.setAttribute(k,v);svg.append(mark);}
 }
 select.onclick=()=>{choosing=!choosing;draft=null;select.setAttribute('aria-pressed',String(choosing));select.textContent=choosing?'בחר טווח · גרור על הגרף':'Fixed Range Volume Profile · בחר טווח';draw();};
 clear.onclick=()=>{range=null;draft=null;clear.hidden=true;if(config)try{localStorage.removeItem(storageKey(config.symbol,config.interval));}catch{}status.textContent='טווח ה־POC נוקה.';draw();};
 const point=e=>{const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const q=p.matrixTransform(svg.getScreenCTM().inverse());return Math.max(0,Math.min(config.bars.length-1,Math.round((q.x-config.bounds.left)/((config.bounds.right-config.bounds.left)/config.bars.length)-.5)));};
 svg.addEventListener('pointerdown',e=>{if(!choosing||!config||e.button!==0)return;e.preventDefault();e.stopPropagation();const i=point(e);draft={a:i,b:i};svg.setPointerCapture(e.pointerId);draw();});
 svg.addEventListener('pointermove',e=>{if(!draft||!config)return;draft.b=point(e);draw();});
 svg.addEventListener('pointerup',e=>{if(!draft||!config)return;e.preventDefault();e.stopPropagation();const d=draft;draft=null;if(Math.abs(d.b-d.a)<1){status.textContent='בחר לפחות שני נרות בטווח.';draw();return;}range={start:Number(config.bars[Math.min(d.a,d.b)].time),end:Number(config.bars[Math.max(d.a,d.b)].time)};choosing=false;select.setAttribute('aria-pressed','false');select.textContent='Fixed Range Volume Profile · שנה טווח';persist();draw();});
 return {update(next){if(!next?.bars?.length)return;const key=next.symbol+':'+next.interval;if(!config||key!==config.symbol+':'+config.interval){config={...next};loadRange();}else config={...next};draw();},clear(){config=null;range=null;draft=null;svg.replaceChildren();status.textContent='ממתין לנרות';}};
}
