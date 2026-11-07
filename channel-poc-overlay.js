// Automatic display of the exact frozen model returned by the entry evaluator.
const NS='http://www.w3.org/2000/svg';
const fmt=n=>Number(n).toLocaleString('en-US',{maximumSignificantDigits:7});
export function drawPocModel(svg,config,model){
 const {bars,bounds,x,y}=config,p=model?.profile,c=model?.channel;
 if(model?.version!=='CHANNEL_POC_RETEST_V1'||!p||!c)return false;
 const add=(tag,attrs,text,parent=svg)=>{const e=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text)e.textContent=text;parent.append(e);return e;};
 const times=bars.map(b=>Number(b.time??b.openTime)),timeIndex=t=>{
  const i=times.indexOf(t);if(i>=0)return i;
  if(t<times[0])return -.5;if(t>times.at(-1))return times.length-.5;
  return times.findIndex(at=>at>=t);
 };
 const a=Math.max(bounds.left,x(timeIndex(model.anchorA.time))),b=Math.min(bounds.right,x(timeIndex(model.anchorB.time))),g=add('g',{'data-poc-model':model.id,'pointer-events':'none'});
 const clipId='poc-clip-'+String(config.symbol).replace(/[^a-z0-9]/gi,'')+'-'+model.side;
 const defs=add('defs',{},null,g),clip=add('clipPath',{id:clipId},null,defs);add('rect',{x:bounds.left,y:bounds.top,width:bounds.right-bounds.left,height:bounds.bottom-bounds.top},null,clip);
 const plot=add('g',{'clip-path':'url(#'+clipId+')'},null,g);
 if(b>a)add('rect',{x:a,y:bounds.top,width:b-a,height:bounds.bottom-bounds.top,fill:'#67d5f1','fill-opacity':'.035',stroke:'#67d5f1','stroke-opacity':'.45','stroke-dasharray':'4 5'},null,plot);
 const maxWidth=Math.min(110,(bounds.right-bounds.left)*.16),left=bounds.left+4;
 p.volumes.forEach((v,i)=>{if(!(v>0))return;const y1=y(p.low+(i+1)*p.step),y2=y(p.low+i*p.step);add('rect',{x:left,y:Math.min(y1,y2)+.5,width:maxWidth*v/p.max,height:Math.max(.5,Math.abs(y2-y1)-1),fill:i===p.index?'#ffe080':'#5ec7e8','fill-opacity':i===p.index?'.92':'.43','data-poc-bin':i},null,plot);});
 const py=y(p.poc);add('line',{x1:bounds.left,y1:py,x2:bounds.right,y2:py,stroke:'#ffe080','stroke-width':2,'stroke-dasharray':'7 4','data-poc-level':p.poc},null,plot);
 const source=config.sourceBars||bars;
 const post=source.filter(b=>Number(b.time??b.openTime)>model.breakoutAt).map(b=>Number(b.time??b.openTime));
 const ordinal=t=>{const i=c.barTimes.indexOf(t),n=c.barTimes.length;return i>=0?i:t===model.breakoutAt?n:n+post.filter(at=>at<=t).length;};
 const pts=times.map((t,i)=>({t,i,n:ordinal(t)})).filter(v=>v.t>=c.anchorAt);
 if(pts.length>=2){const first=pts[0],last=pts.at(-1);for(const sign of [-1,1])add('line',{x1:x(first.i),x2:x(last.i),y1:y(c.intercept+c.slope*first.n+sign*c.width),y2:y(c.intercept+c.slope*last.n+sign*c.width),stroke:'#ffb547','stroke-width':2,'data-frozen-channel':model.side},null,plot);}
 const range=model.consolidation;
 if(range?.low>0){const l=Math.max(bounds.left,x(timeIndex(range.startAt))),r=Math.min(bounds.right,x(timeIndex(range.endAt-300000)));if(r>=l)add('rect',{x:l-3,y:y(range.high),width:Math.max(6,r-l+6),height:Math.max(2,y(range.low)-y(range.high)),fill:'#c99bff','fill-opacity':'.12',stroke:'#c99bff','stroke-dasharray':'3 3'},null,plot);}
 const text=(value,px,py,color)=>add('text',{x:px,y:py,fill:color,'font-size':11,'font-weight':'bold','text-anchor':'end',style:'paint-order:stroke;stroke:#08111f;stroke-width:4px'},value,g);
 text(model.side+' · POC משוער '+fmt(p.poc),bounds.right-7,Math.max(bounds.top+16,Math.min(bounds.bottom-7,py-7)),'#ffe080');
 for(const [tag,point]of [['A',model.anchorA],['B',model.anchorB]])if(point.time>=times[0]&&point.time<=times.at(-1)){const xx=x(timeIndex(point.time)),yy=y(point.price);add('circle',{cx:xx,cy:yy,r:3,fill:'#67d5f1'},null,plot);text(tag,xx-5,Math.max(bounds.top+14,Math.min(bounds.bottom-5,yy-8)),'#67d5f1');}
 return true;
}
