// Presentation only. Never trim the history supplied to trading/indicator calculations.
export const candleTime=bar=>Number.isFinite(Number(bar.openTime))?Number(bar.openTime):Number.isFinite(bar.time)?bar.time:Date.parse(bar.date);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function createChartViewport(){
 let key=null,count=null,anchor=null,all=false,last=null;
 function view(bars,{context='',width=850}={}){
  if(context!==key){key=context;anchor=null;}
  const total=bars.length,automatic=clamp(Math.floor((width-100)/9),24,96);
  const size=Math.min(total,all?total:count??automatic),maxStart=Math.max(0,total-size);
  let start=maxStart;
  if(anchor!==null&&total){
   // Keep the same historical candle when refreshes append/trim the loaded history.
   let lo=0,hi=total;
   while(lo<hi){const mid=(lo+hi)>>1;if(candleTime(bars[mid])<anchor)lo=mid+1;else hi=mid;}
   start=clamp(lo,0,maxStart);
  }
  last={bars,start,end:start+size,size,total,maxStart,following:anchor===null};
  return {...last,bars:bars.slice(start,start+size)};
 }
 function seek(start){
  if(!last?.total)return;
  const index=clamp(Math.round(Number(start)||0),0,last.maxStart);
  anchor=index===last.maxStart?null:candleTime(last.bars[index]);
 }
 return {view,seek,move(delta){if(last)seek(last.start+delta);},latest(){anchor=null;},
  zoom(factor,fraction){
   if(!last?.total||!Number.isFinite(factor)||factor<=0)return;
   const next=clamp(Math.round(last.size*factor),Math.min(6,last.total),last.total);
   // Mouse/pinch zoom keeps the candle under the pointer in the same screen position.
   // Button zoom retains the existing historical-start/latest behavior.
   if(Number.isFinite(fraction)){
    const f=clamp(fraction,0,1),index=clamp(Math.round(last.start+(last.size-next)*f),0,last.total-next);
    anchor=index===last.total-next?null:candleTime(last.bars[index]);
   }
   count=next;all=false;
  },
  showAll(){all=true;anchor=null;},reset(){count=null;all=false;anchor=null;}
 };
}
