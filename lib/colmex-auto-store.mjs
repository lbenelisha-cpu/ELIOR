import {getStore} from '@netlify/blobs';
import {randomUUID} from 'node:crypto';
import {initialState} from './colmex-auto-runner.mjs';
export const autoStore=()=>getStore({name:'levi-colmex-auto-live-v1',consistency:'strong'});
export const stateKey=id=>'account-'+id;
export async function lease(store,id,now=Date.now){
 const key=stateKey(id),current=await store.getWithMetadata(key,{type:'json'}),owner=randomUUID();
 if(current?.data?.lease?.until>now())return null;
 const state=current?.data?.state||initialState(now());if(state.version!==1)throw Error('STATE_VERSION');
 const value={state,lease:{owner,until:now()+55000}};
 const written=await store.setJSON(key,value,current?{onlyIfMatch:current.etag}:{onlyIfNew:true});if(!written.modified)return null;
 let etag=written.etag;
 async function save(next){
  if(now()>=value.lease.until)throw Error('LEASE_EXPIRED');value.state=next;
  const r=await store.setJSON(key,value,{onlyIfMatch:etag});if(!r.modified)throw Error('LEASE_LOST');etag=r.etag;
 }
 async function release(){value.lease.until=0;const r=await store.setJSON(key,value,{onlyIfMatch:etag});if(!r.modified)throw Error('LEASE_LOST');}
 return {state,save,release};
}
