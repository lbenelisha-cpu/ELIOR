import {getStore} from '@netlify/blobs';
import {randomUUID} from 'node:crypto';
import {validateLiveState} from './colmex-live-state.mjs';
import {initialState} from './colmex-auto-runner.mjs';
export const autoStore=()=>getStore({name:'levi-colmex-auto-live-v1',consistency:'strong'});
export const stateKey=id=>'account-'+id;
export async function lease(store,id,now=Date.now){
 const key=stateKey(id),current=await store.getWithMetadata(key,{type:'json'}),owner=randomUUID();
 if(current?.data?.lease?.until>now())return null;
 const state=validateLiveState(current?current.data?.state:initialState(now()));
 let value={state:structuredClone(state),lease:{owner,until:now()+55000}};
 const written=await store.setJSON(key,value,current?{onlyIfMatch:current.etag}:{onlyIfNew:true});if(!written.modified)return null;
 let etag=written.etag;
 async function save(next){
  try{
  if(now()>=value.lease.until)throw Error('LEASE_EXPIRED');
  const candidate={state:structuredClone(validateLiveState(next)),lease:{...value.lease}};
  const r=await store.setJSON(key,candidate,{onlyIfMatch:etag});if(!r.modified)throw Error('LEASE_LOST');etag=r.etag;value=candidate;
  }catch(error){
   const code=['LEASE_EXPIRED','LEASE_LOST','STATE_SCHEMA','STATE_VERSION'].includes(error.message)?error.message:'STATE_SAVE_FAILED';
   throw Object.assign(Error(code),{statePersistenceFailure:true});
  }
 }
 async function release(){const released={...value,lease:{...value.lease,until:0}};const r=await store.setJSON(key,released,{onlyIfMatch:etag});if(!r.modified)throw Error('LEASE_LOST');}
 return {state,save,release};
}
