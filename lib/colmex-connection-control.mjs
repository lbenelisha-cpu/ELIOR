import {createHash,randomUUID} from 'node:crypto';
import {getStore} from '@netlify/blobs';
const failure=code=>Object.assign(Error(code),{code,status:503});
export class ColmexConnectionControl{
 constructor({login,password,store=()=>getStore({name:'levi-colmex-sessions-v1',consistency:'strong'}),now=Date.now}){this.store=store;this.now=now;this.key='connection-'+createHash('sha256').update(String(login).trim()+'\0'+password).digest('hex');}
 storage(){return typeof this.store==='function'?this.store():this.store;}
 async read(){try{const r=await this.storage().getWithMetadata(this.key,{type:'json'});if(!r)return {enabled:true,revision:'legacy',updatedAt:null,settledAt:null};const v=r.data;if(typeof v?.enabled!=='boolean'||typeof v.revision!=='string')throw Error();return v;}catch{throw failure('CONNECTION_STATE_UNAVAILABLE');}}
 async assertEnabled(){const r=await this.read();if(!r.enabled)throw failure('CONNECTION_PAUSED');return r.revision;}
 async setEnabled(enabled){
  if(typeof enabled!=='boolean')throw failure('INVALID_REQUEST');
  const store=this.storage(),current=await store.getWithMetadata(this.key,{type:'json'});
  if(current?.data?.enabled===enabled)return this.read();
  const at=this.now(),next={enabled,revision:randomUUID(),updatedAt:at,settledAt:enabled?at:at+30000};
  const saved=await store.setJSON(this.key,next,current?{onlyIfMatch:current.etag}:{onlyIfNew:true});
  if(!saved.modified)throw failure('CONNECTION_STATE_CHANGED');return next;
 }
}
