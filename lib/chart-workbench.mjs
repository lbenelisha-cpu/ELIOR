// Display-only calculations shared by both broker charts.
export const TOOLS=['select','horizontal','trend','rectangle','risk'];
export function validShape(d){return !!d&&typeof d.id==='string'&&d.id.length<=80&&TOOLS.includes(d.type)&&d.type!=='select'&&/^#[0-9a-f]{6}$/i.test(d.color)&&Array.isArray(d.points)&&d.points.length===({horizontal:1,risk:3}[d.type]||2)&&d.points.every(p=>Number.isFinite(p.time)&&p.time>=0&&Number.isFinite(p.price)&&p.price>0);}
export function riskMetrics(d){if(d?.type!=='risk'||!validShape(d))return null;const [entry,target,stop]=d.points.map(p=>p.price);if(!(stop<entry&&entry<target))return null;return {entry,target,stop,rewardPct:100*(target/entry-1),riskPct:100*(1-stop/entry),ratio:(target-entry)/(entry-stop)};}
export function geometry(bars,low,high,{left=20,right=750,top=25,bottom=275}={}){
 const times=bars.map(b=>Number.isFinite(b.time)?b.time:Date.parse(b.date)),n=times.length,step=(right-left)/n;
 const x=i=>left+(i+.5)*step,y=price=>bottom-(price-low)/(high-low)*(bottom-top);
 function timeToIndex(time){if(n===1)return 0;let i=0;while(i<n-2&&times[i+1]<time)i++;return i+(time-times[i])/(times[i+1]-times[i]);}
 function indexToTime(i){if(n===1)return times[0];const a=Math.max(0,Math.min(n-2,Math.floor(i)));return times[a]+(i-a)*(times[a+1]-times[a]);}
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 return {x,y,pointToPixel:p=>({x:x(timeToIndex(p.time)),y:y(p.price)}),pixelToPoint:p=>({time:indexToTime(clamp((p.x-left)/step-.5,0,n-1)),price:Math.max(Number.MIN_VALUE,low+(bottom-clamp(p.y,top,bottom))/(bottom-top)*(high-low))}),bounds:{left:x(0),right:x(n-1),top,bottom}};
}
export function moveShape(d,g,dx,dy,endpoint=null){
 const pixels=d.points.map(g.pointToPixel),b=g.bounds,clamp=(v,a,z)=>Math.max(a,Math.min(z,v));
 if(endpoint!==null){const p=g.pixelToPoint({x:pixels[endpoint].x+dx,y:pixels[endpoint].y+dy});const points=d.points.map(a=>({...a}));points[endpoint]=p;const next={...d,points};return d.type==='risk'&&!riskMetrics(next)?d:next;}
 if(d.type==='horizontal')dx=0;
 else dx=clamp(dx,b.left-Math.min(...pixels.map(p=>p.x)),b.right-Math.max(...pixels.map(p=>p.x)));
 dy=clamp(dy,b.top-Math.min(...pixels.map(p=>p.y)),b.bottom-Math.max(...pixels.map(p=>p.y)));
 return {...d,points:pixels.map(p=>g.pixelToPoint({x:p.x+dx,y:p.y+dy}))};
}
export function volumeSeries(bars){
 const values=bars.map(b=>b.volume!==null&&b.volume!==undefined&&b.volume!==''&&Number.isFinite(Number(b.volume))&&Number(b.volume)>=0?Number(b.volume):null);
 return values.map((value,i)=>({value,up:Number(bars[i].close)>=Number(bars[i].open),average:i>=19&&values.slice(i-19,i+1).every(v=>v!==null)?values.slice(i-19,i+1).reduce((a,b)=>a+b,0)/20:null}));
}
