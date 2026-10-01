import {readFile} from 'node:fs/promises';import {homedir} from 'node:os';import {join} from 'node:path';
export class PushRelay{
 constructor(client,config,fetcher=fetch){this.client=client;this.config=config;this.fetcher=fetcher;this.previous=new Map();this.initialized=false;this.running=false;this.lastStatus=config?'ממתין להתראת Push חדשה':'Push לא הוגדר';}
 async send(event){if(!this.config)return;try{const response=await this.fetcher(this.config.site+'/.netlify/functions/push-api?action=publish',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+this.config.token},body:JSON.stringify(event),signal:AbortSignal.timeout(12000),redirect:'error'});if(!response.ok)throw Error('Push endpoint rejected');const result=await response.json();this.lastStatus=result.duplicate?'האירוע כבר נשלח':result.accepted>0?'שירות Push קיבל את ההתראה; מסירה תלויה במכשיר':'שירות Push לא אישר מסירה למכשיר';}catch{this.lastStatus='שליחת Push לא הצליחה; אין ניסיון חוזר אוטומטי';}}
 async poll(){if(!this.config||this.running)return;this.running=true;try{
  const snapshot=await this.client.snapshot();const next=new Map();
  if(!snapshot.connected){next.set('connection','disconnected');if(this.initialized&&this.previous.get('connection')!=='disconnected')await this.send({id:'connection:'+Math.floor(Date.now()/60000),timestamp:Date.now(),type:'disconnected',symbol:''});}
  else{next.set('connection','connected');for(const q of snapshot.quotes||[]){const kind=q.status==='current'&&q.confirmed?q.kind:'none';next.set(q.symbol,kind);next.set(q.symbol+'-risk',q.status==='current'&&!!q.quoteRisk);
   if(this.initialized&&['positive','negative'].includes(kind)&&this.previous.get(q.symbol)!==kind)await this.send({id:q.symbol+':'+q.barTime+':'+kind,timestamp:Date.now(),type:kind,symbol:q.symbol});
   if(this.initialized&&next.get(q.symbol+'-risk')&&!this.previous.get(q.symbol+'-risk'))await this.send({id:q.symbol+':'+q.barTime+':risk',timestamp:Date.now(),type:'risk',symbol:q.symbol});
  }}this.previous=next;this.initialized=true;
 }catch{if(this.initialized&&this.previous.get('connection')!=='disconnected'){this.previous.set('connection','disconnected');await this.send({id:'connection:'+Math.floor(Date.now()/60000),timestamp:Date.now(),type:'disconnected',symbol:''});}}finally{this.running=false;}}
 start(){if(!this.config)return;this.poll();this.timer=setInterval(()=>this.poll(),30000);this.timer.unref();}
 stop(){clearInterval(this.timer);}
}
export async function loadPushRelay(client){let config=null;try{const raw=JSON.parse(await readFile(process.env.LEVI_PUSH_CONFIG||join(homedir(),'.levi','push-config.json'),'utf8'));const site=new URL(raw.site);if(site.protocol!=='https:'||site.origin!=='https://levi-emptying-tracker.netlify.app'||typeof raw.token!=='string'||raw.token.length<24)throw Error('Invalid config');config={site:site.origin,token:raw.token};}catch{}return new PushRelay(client,config);}
