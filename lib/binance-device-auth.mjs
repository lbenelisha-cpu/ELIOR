import fs from 'node:fs';import path from 'node:path';import {createHash,randomBytes,randomInt,timingSafeEqual} from 'node:crypto';
const DAY=86400000,hash=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value),{mode:0o600});fs.chmodSync(file+'.tmp',0o600);fs.renameSync(file+'.tmp',file);}
function read(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function failure(message,status=401){return Object.assign(Error(message),{status});}
export class DeviceControlSessions{
 constructor(file,{authority,now=()=>Date.now()}={}){
  this.file=file;this.pairFile=file+'.pair';this.now=now;this.enabled=typeof authority==='string'&&authority.length>=32;this.authority=this.enabled?hash(authority):null;
  if(this.enabled&&read(file)?.authority!==this.authority)write(file,{version:1,authority:this.authority,sessions:[]});
 }
 state(){const state=read(this.file);return state?.authority===this.authority&&Array.isArray(state.sessions)?state:null;}
 authorized(header){
  if(!this.enabled||typeof header!=='string'||!/^Bearer device-[a-f0-9]{64}$/.test(header))return false;
  const candidate=hash(header.slice(7)),now=this.now();
  return !!this.state()?.sessions.some(s=>s.expiresAt>now&&equal(s.hash,candidate));
 }
 issue(code){
  if(!this.enabled)throw failure('חיבור מכשירים אינו מוגדר בשרת',503);
  const now=this.now(),pair=read(this.pairFile),state=this.state();
  if(!state||pair?.authority!==this.authority||!(pair.reusable===true||pair.expiresAt>now))throw failure('אין קוד חיבור פעיל. הפק קוד קצר חדש במסוף השרת.');
  if(pair.reusable===true&&pair.blockedUntil&&pair.blockedUntil<=now){pair.failures=0;pair.blockedUntil=0;}
  if(pair.failures>=5)throw failure(pair.reusable?'יותר מדי ניסיונות. אפשר לנסות את אותו הקוד שוב בעוד 15 דקות.':'קוד החיבור נחסם. הפק קוד קצר חדש במסוף השרת.',429);
  if(typeof code!=='string'||!/^\d{6}$/.test(code)||!equal(pair.hash,hash(pair.salt+':'+code))){pair.failures=(pair.failures||0)+1;if(pair.reusable===true&&pair.failures>=5)pair.blockedUntil=now+15*60000;write(this.pairFile,pair);throw failure('קוד החיבור הקצר אינו נכון');}
  // Legacy OTPs are consumed; owner-configured fixed codes remain reusable.
  if(pair.reusable===true)write(this.pairFile,pair);else fs.unlinkSync(this.pairFile);
  const token='device-'+randomBytes(32).toString('hex'),expiresAt=now+(pair.reusable?365:180)*DAY;
  if(pair.reusable&&state.sessions.filter(s=>s.expiresAt>now).length>=64)throw failure('מגבלת 64 מכשירים. נתק מכשיר ישן לפני חיבור נוסף.',429);
  state.sessions=state.sessions.filter(s=>s.expiresAt>now);if(!pair.reusable)state.sessions=state.sessions.slice(-7);
  state.sessions.push({hash:hash(token),createdAt:now,expiresAt});write(this.file,state);
  return {ok:true,token,expiresAt:new Date(expiresAt).toISOString()};
 }
 revoke(header){const state=this.state();if(!state)return;const candidate=hash(String(header||'').replace(/^Bearer /,''));state.sessions=state.sessions.filter(s=>!equal(s.hash,candidate));write(this.file,state);}
}
// Owner-side configuration only. Legacy OTPs expire in 15 minutes; an explicit
// reusable code remains hashed on disk, with a 15-minute cooldown after 5 failures.
export function createDevicePairCode(file,{now=Date.now(),reusable=false,code:chosenCode}={}){
 const state=read(file);if(!state?.authority)throw failure('יש להתקין ולהפעיל תחילה את עדכון חיבור המכשירים.',503);
 if(chosenCode!==undefined&&(typeof chosenCode!=='string'||!/^\d{6}$/.test(chosenCode)))throw failure('יש לבחור שש ספרות',400);
 const code=chosenCode??String(randomInt(0,1000000)).padStart(6,'0'),salt=randomBytes(16).toString('hex'),expiresAt=reusable?null:now+15*60000;
 write(file+'.pair',{authority:state.authority,salt,hash:hash(salt+':'+code),expiresAt,failures:0,reusable});return {code,expiresAt,reusable};
}
