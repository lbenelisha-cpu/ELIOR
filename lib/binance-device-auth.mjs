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
  if(!state||pair?.authority!==this.authority||!(pair.expiresAt>now))throw failure('אין קוד חיבור פעיל. הפק קוד קצר חדש במסוף השרת.');
  if(pair.failures>=5)throw failure('קוד החיבור נחסם. הפק קוד קצר חדש במסוף השרת.',429);
  if(typeof code!=='string'||!/^\d{6}$/.test(code)||!equal(pair.hash,hash(pair.salt+':'+code))){pair.failures=(pair.failures||0)+1;write(this.pairFile,pair);throw failure('קוד החיבור הקצר אינו נכון');}
  // Consume synchronously before returning; a replay can never mint another token.
  fs.unlinkSync(this.pairFile);
  const token='device-'+randomBytes(32).toString('hex'),expiresAt=now+180*DAY;
  state.sessions=state.sessions.filter(s=>s.expiresAt>now).slice(-7);
  state.sessions.push({hash:hash(token),createdAt:now,expiresAt});write(this.file,state);
  return {ok:true,token,expiresAt:new Date(expiresAt).toISOString()};
 }
 revoke(header){const state=this.state();if(!state)return;const candidate=hash(String(header||'').replace(/^Bearer /,''));state.sessions=state.sessions.filter(s=>!equal(s.hash,candidate));write(this.file,state);}
}
// Owner-side command only, never an HTTP route. The 6-digit secret is single use,
// expires after 15 minutes, and is locked globally after five incorrect attempts.
export function createDevicePairCode(file,{now=Date.now()}={}){
 const state=read(file);if(!state?.authority)throw failure('יש להתקין ולהפעיל תחילה את עדכון חיבור המכשירים.',503);
 const code=String(randomInt(0,1000000)).padStart(6,'0'),salt=randomBytes(16).toString('hex'),expiresAt=now+15*60000;
 write(file+'.pair',{authority:state.authority,salt,hash:hash(salt+':'+code),expiresAt,failures:0});return {code,expiresAt};
}
