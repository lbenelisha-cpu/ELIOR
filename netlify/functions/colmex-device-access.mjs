import {getStore} from '@netlify/blobs';
import {runtimeEnvironment} from '../../lib/colmex-auto-policy.mjs';
import {deviceStoreName,deviceConfigured,pairDevice,requireDevice,sameOrigin,accessError} from '../../lib/colmex-device-access.mjs';
export function makeDeviceHandler({env=process.env,storeFactory=()=>getStore({name:deviceStoreName,consistency:'strong'})}={}){
 return async(request,context)=>{
  const vars=runtimeEnvironment(env,context),reply=(code,data)=>new Response(JSON.stringify(data),{status:code,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  try{
   if(request.method==='GET')return reply(200,{configured:deviceConfigured(vars),pairingConfigured:deviceConfigured(vars)&&/^\d{6}$/.test(vars.COLMEX_DEVICE_PAIR_CODE||'')});
   if(request.method!=='POST')return reply(405,{error:'METHOD_NOT_ALLOWED'});
   if(!sameOrigin(request))throw accessError('ORIGIN_REQUIRED',403);
   const body=await request.text();if(body.length>1000)throw accessError('INVALID_REQUEST');const input=JSON.parse(body);
   const store=storeFactory();
   if(input.action==='pair')return reply(200,{ok:true,...await pairDevice(store,vars,input.code)});
   if(input.action==='disconnect'){const key=await requireDevice(store,vars,request.headers.get('authorization'));await store.delete(key);return reply(200,{ok:true});}
   throw accessError('INVALID_REQUEST');
  }catch(error){return reply(error.status||503,{ok:false,error:error.code||'ACCESS_UNAVAILABLE'});}
 };
}
export default makeDeviceHandler();
