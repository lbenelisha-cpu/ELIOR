const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
export function validDrawing(d){return !!d&&typeof d.id==='string'&&d.id.length<=80&&['horizontal','trend'].includes(d.type)&&/^#[0-9a-f]{6}$/i.test(d.color)&&Array.isArray(d.points)&&d.points.length===(d.type==='horizontal'?1:2)&&d.points.every(p=>Number.isFinite(p.time)&&p.time>=0&&Number.isFinite(p.price)&&p.price>0);}
export function chartGeometry(bars,low,high){
 const times=bars.map(b=>Date.parse(b.date)),n=times.length;
 const x=i=>20+(i+.5)*730/n,y=price=>275-(price-low)/(high-low)*250;
 function timeToIndex(time){if(n===1)return 0;let i=0;while(i<n-2&&times[i+1]<time)i++;return i+(time-times[i])/(times[i+1]-times[i]);}
 function indexToTime(i){if(n===1)return times[0];const a=clamp(Math.floor(i),0,n-2);return times[a]+(i-a)*(times[a+1]-times[a]);}
 return {x,y,pointToPixel:p=>({x:x(timeToIndex(p.time)),y:y(p.price)}),pixelToPoint:p=>({time:indexToTime(clamp((p.x-20)*n/730-.5,0,n-1)),price:Math.max(Number.MIN_VALUE,low+(275-clamp(p.y,25,275))/250*(high-low))}),bounds:{left:x(0),right:x(n-1),top:25,bottom:275}};
}
export function moveDrawing(d,geometry,dx,dy,endpoint=null){
 const points=d.points.map(p=>({...p}));
 if(endpoint!==null){const pixel=geometry.pointToPixel(points[endpoint]);points[endpoint]=geometry.pixelToPoint({x:pixel.x+dx,y:pixel.y+dy});}
 else if(d.type==='horizontal'){const pixel=geometry.pointToPixel(points[0]);points[0]=geometry.pixelToPoint({x:pixel.x,y:pixel.y+dy});}
 else {const pixels=points.map(geometry.pointToPixel),b=geometry.bounds;dx=clamp(dx,b.left-Math.min(...pixels.map(p=>p.x)),b.right-Math.max(...pixels.map(p=>p.x)));dy=clamp(dy,b.top-Math.min(...pixels.map(p=>p.y)),b.bottom-Math.max(...pixels.map(p=>p.y)));points.forEach((_,i)=>points[i]=geometry.pixelToPoint({x:pixels[i].x+dx,y:pixels[i].y+dy}));}
 return {...d,points};
}
