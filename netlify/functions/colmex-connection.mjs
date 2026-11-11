import {getStore} from '@netlify/blobs';
import {ColmexConnectionControl} from '../../lib/colmex-connection-control.mjs';
import {runtimeEnvironment} from '../../lib/colmex-auto-policy.mjs';
import {deviceStoreName,requireDevice,sameOrigin,accessError} from '../../lib/colmex-device-access.mjs';
export function makeConnectionHandler({env=process.env,deviceStoreFactory=()=>getStore({name:deviceStoreName,consistency:'strong'}),controlFactory=vars=>new ColmexConnectionControl({login:vars.COLMEX_API_LOGIN,password:vars.COLMEX_API_PASSWORD})}={}){
 return async(request,context)=>{
  const vars=runtimeEnvironment(env,context),reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  try{
   if(!['GET','POST'].includes(request.method))throw accessError('METHOD_NOT_ALLOWED',405);
   if(!vars.COLMEX_API_LOGIN||!vars.COLMEX_API_PASSWORD)throw accessError('MISSING_CREDENTIALS',503);
   const control=controlFactory(vars);let state;
   if(request.method==='GET')state=await control.read();
   else{
    if(!sameOrigin(request))throw accessError('ORIGIN_REQUIRED',403);
    await requireDevice(deviceStoreFactory(),vars,request.headers.get('authorization'));
    const raw=await request.text();if(raw.length>100)throw accessError('INVALID_REQUEST');
    let input;try{input=JSON.parse(raw);}catch{throw accessError('INVALID_REQUEST');}
    if(!['connect','disconnect'].includes(input?.action)||Object.keys(input).length!==1)throw accessError('INVALID_REQUEST');
    state=await control.setEnabled(input.action==='connect');
   }
   return reply(200,{ok:true,enabled:state.enabled,updatedAt:state.updatedAt,settledAt:state.settledAt,brokerLogout:false});
  }catch(e){return reply(e.status||503,{ok:false,error:e.code||'CONNECTION_STATE_UNAVAILABLE'});}
 };
}
export default makeConnectionHandler();
