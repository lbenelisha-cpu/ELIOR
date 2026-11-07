import {randomBytes,createHash} from 'node:crypto';
import {colmexFastCandidates} from './colmex-poc-fast.mjs';
import {configuredLive} from './colmex-auto-policy.mjs';
const endpoint='https://levi-emptying-tracker.netlify.app/.netlify/functions/colmex-poc-fast-background';
const key=token=>'poc-fast-ticket-'+createHash('sha256').update(token).digest('hex');
export async function dispatchColmexFast({store,env,state,now=Date.now,fetchImpl=fetch}){
 if(!configuredLive(env))return false;
 if(!state)state=(await store.get('account-'+env.COLMEX_AUTO_ACCOUNT_ID,{type:'json'}))?.state;
 if(!colmexFastCandidates(state,env,now()).length)return false;
 const token=randomBytes(32).toString('hex'),issuedAt=now(),ticket={account:env.COLMEX_AUTO_ACCOUNT_ID,issuedAt,until:issuedAt+75000,claimed:false};
 const written=await store.setJSON(key(token),ticket,{onlyIfNew:true});if(!written.modified)return false;
 try{const r=await fetchImpl(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(2000),headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:token})});if(r.status!==202)throw Error('FAST_DISPATCH_UNAVAILABLE');return true;}
 catch{await store.delete(key(token));return false;}
}
export async function claimColmexFastTicket({token,store,env,now=Date.now}){
 if(!configuredLive(env)||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return null;
 const k=key(token),saved=await store.getWithMetadata(k,{type:'json'}),ticket=saved?.data;
 if(ticket?.account===env.COLMEX_AUTO_ACCOUNT_ID&&Number.isFinite(ticket.until)&&ticket.until<now()){await store.delete(k);return null;}
 if(!ticket||ticket.claimed||ticket.account!==env.COLMEX_AUTO_ACCOUNT_ID||!Number.isFinite(ticket.issuedAt)||ticket.issuedAt>now()||now()-ticket.issuedAt>15000||ticket.until!==ticket.issuedAt+75000)return null;
 const r=await store.setJSON(k,{...ticket,claimed:true},{onlyIfMatch:saved.etag});if(!r.modified)return null;
 await store.delete(k);return ticket;
}
