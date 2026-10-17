// Serializes order execution. Manual requests waiting for the current cycle
// take precedence over new automatic scans; a timeout never releases its lock.
export class LiveExecutionLock {
 busy=false;
 waiting=[];
 async automatic(run){
  if(this.busy||this.waiting.length)return;
  this.busy=true;
  try{return await run();}finally{this.release();}
 }
 async manual(run,waitMs=8000){
  if(this.busy){
   await new Promise((resolve,reject)=>{
    const waiter={resolve,timer:null};
    waiter.timer=setTimeout(()=>{
     this.waiting=this.waiting.filter(item=>item!==waiter);
     reject(Error('הפעולה הקודמת עדיין מתבצעת. המכירה או הקנייה הזו לא נשלחה; נסה שוב בעוד מספר שניות.'));
    },waitMs);
    this.waiting.push(waiter);
   });
  }else this.busy=true;
  try{return await run();}finally{this.release();}
 }
 release(){
  const next=this.waiting.shift();
  if(next){clearTimeout(next.timer);next.resolve();}
  else this.busy=false;
 }
}
