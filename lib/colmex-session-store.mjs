// Server-only session reuse across the account view, charts and scheduled worker.
// Stored tokens are encrypted with the existing broker credential; no public reader.
import {createHash,createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {getStore,connectLambda} from '@netlify/blobs';
const error=code=>Object.assign(Error(code),{code});
const safeCode=code=>['AUTH_DENIED','AUTH_RESPONSE','RATE_LIMIT','NETWORK','UPSTREAM_HTTP','BROKER_NOT_READY','BROKER_ERROR_RESPONSE'].includes(code)?code:'SESSION_STORE_UNAVAILABLE';
export function connectColmexStore(event){if(typeof event?.blobs==='string')connectLambda(event);}
export function sharedColmexSession(options){return new ColmexSessionStore({...options,store:()=>getStore({name:'levi-colmex-sessions-v1',consistency:'strong'})});}
export class ColmexSessionStore{
 constructor({login,password,store,now=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  this.store=store;this.now=now;this.wait=wait;
  this.key=createHash('sha256').update('colmex-session-key-v1\0'+String(login).trim()+'\0'+password).digest('hex');
  this.secret=createHash('sha256').update('colmex-session-encryption-v1\0'+String(login).trim()+'\0'+password).digest();
 }
 encode(session){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.secret,iv);cipher.setAAD(Buffer.from(this.key));const body=Buffer.concat([cipher.update(JSON.stringify(session),'utf8'),cipher.final()]);return {iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),body:body.toString('base64')};}
 decode(value){if(!value)return null;try{const decipher=createDecipheriv('aes-256-gcm',this.secret,Buffer.from(value.iv,'base64'));decipher.setAAD(Buffer.from(this.key));decipher.setAuthTag(Buffer.from(value.tag,'base64'));const d=JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.body,'base64')),decipher.final()]).toString('utf8'));return typeof d.token==='string'&&d.token.length>0&&d.token.length<=16000&&!/[\s"']/.test(d.token)&&Number.isFinite(d.expiry)?d:null;}catch{return null;}}
 async acquire(authenticate,rejectedToken=null){
  let store;try{store=typeof this.store==='function'?this.store():this.store;}catch{throw error('SESSION_STORE_UNAVAILABLE');}
  for(let attempt=0;attempt<25;attempt++){
   let current;try{current=await store.getWithMetadata(this.key,{type:'json'});}catch{throw error('SESSION_STORE_UNAVAILABLE');}
   const record=current?.data||{},session=this.decode(record.encrypted),now=this.now();
   if(session&&session.expiry>now+30000&&session.token!==rejectedToken)return session;
   if(record.retryAt>now)throw error(safeCode(record.error));
   if(record.lease?.until>now){await this.wait(250);continue;}
   const lease={owner:randomUUID(),until:now+20000};let reserved;
   try{reserved=await store.setJSON(this.key,{version:1,encrypted:record.encrypted||null,lease},current?{onlyIfMatch:current.etag}:{onlyIfNew:true});}catch{throw error('SESSION_STORE_UNAVAILABLE');}
   if(!reserved.modified){await this.wait(100);continue;}
   try{
    const next=await authenticate();
    if(!(next?.expiry>this.now()+30000)||!this.decode(this.encode(next)))throw error('AUTH_RESPONSE');
    const saved=await store.setJSON(this.key,{version:1,encrypted:this.encode(next),lease:null},{onlyIfMatch:reserved.etag});
    if(!saved.modified)throw error('SESSION_STORE_UNAVAILABLE');return next;
   }catch(e){
    try{await store.setJSON(this.key,{version:1,encrypted:null,lease:null,retryAt:this.now()+30000,error:safeCode(e.code)},{onlyIfMatch:reserved.etag});}catch{}
    throw error(safeCode(e.code));
   }
  }
  throw error('SESSION_BUSY');
 }
}
