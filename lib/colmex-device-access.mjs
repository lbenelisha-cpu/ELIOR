import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
export const deviceStoreName='levi-colmex-device-access-v1';
export const accessError=(code,status=400)=>Object.assign(Error(code),{status,code});
const authority=env=>hash([env.COLMEX_API_LOGIN,env.COLMEX_API_PASSWORD,env.COLMEX_AUTO_ACCOUNT_ID].join('\0'));
export function deviceConfigured(env){return env.CONTEXT==='production'&&/^\d+$/.test(env.COLMEX_AUTO_ACCOUNT_ID||'')&&!!env.COLMEX_API_LOGIN&&!!env.COLMEX_API_PASSWORD;}
export function sameOrigin(request){return request.headers.get('origin')===new URL(request.url).origin&&request.headers.get('content-type')?.split(';')[0]==='application/json';}
export async function pairDevice(store,env,code,now=Date.now()){
 if(!deviceConfigured(env)||!/^\d{6}$/.test(env.COLMEX_DEVICE_PAIR_CODE||''))throw accessError('PAIRING_NOT_CONFIGURED',503);
 const key='fixed-pair-v2-'+hash(authority(env)+':'+env.COLMEX_DEVICE_PAIR_CODE);
 const current=await store.getWithMetadata(key,{type:'json'});
 let state=current?.data||{failures:0,blockedUntil:0};
 if(state.blockedUntil>now)throw accessError('PAIR_CODE_COOLDOWN',429);
 if(state.blockedUntil&&state.blockedUntil<=now)state={failures:0,blockedUntil:0};
 const match=typeof code==='string'&&/^\d{6}$/.test(code)&&timingSafeEqual(Buffer.from(code),Buffer.from(env.COLMEX_DEVICE_PAIR_CODE));
 const failures=state.failures+(match?0:1),next={failures,blockedUntil:failures>=5?now+15*60000:0};
 const result=await store.setJSON(key,next,current?{onlyIfMatch:current.etag}:{onlyIfNew:true});
 if(!result.modified)throw accessError('PAIR_CODE_RETRY',409);
 if(!match)throw accessError('PAIR_CODE_INVALID',401);
 const token='colmex-device-'+randomBytes(32).toString('hex'),expiresAt=now+365*86400000;
 await store.setJSON('session-'+hash(token),{authority:authority(env),expiresAt});
 return {token,expiresAt};
}
export async function requireDevice(store,env,header,now=Date.now()){
 if(!deviceConfigured(env)||!/^Bearer colmex-device-[a-f0-9]{64}$/.test(header||''))throw accessError('DEVICE_REQUIRED',401);
 const key='session-'+hash(header.slice(7)),session=await store.get(key,{type:'json'});
 if(!session||session.authority!==authority(env)||!(session.expiresAt>now))throw accessError('DEVICE_REQUIRED',401);
 return key;
}
