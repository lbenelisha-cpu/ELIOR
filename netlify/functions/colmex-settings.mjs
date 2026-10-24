import {getStore} from '@netlify/blobs';
import {autoStore,lease,stateKey} from '../../lib/colmex-auto-store.mjs';
import {runtimeEnvironment} from '../../lib/colmex-auto-policy.mjs';
import {deviceStoreName,requireDevice,sameOrigin} from '../../lib/colmex-device-access.mjs';
import {validateTradeSettings} from '../../lib/trade-settings.mjs';
export function makeSettingsHandler({env:vars=process.env,storeFactory=autoStore,leaseFactory=lease,deviceStoreFactory=()=>getStore({name:deviceStoreName,consistency:'strong'}),authorize=requireDevice}={}){return async function(request,context){
 const env=runtimeEnvironment(vars,context),store=storeFactory(),id=env.COLMEX_AUTO_ACCOUNT_ID;
 const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});let lock;
 try{
  if(!/^\d+$/.test(id||''))return reply(503,{error:'ACCOUNT_NOT_CONFIGURED'});
  if(request.method==='GET'){const data=await store.get(stateKey(id),{type:'json'});return reply(200,{revision:data?.state?.settingsRevision||0,values:validateTradeSettings(data?.state?.settings||{})});}
  if(request.method!=='POST')return reply(405,{});
  if(env.CONTEXT!=='production'||!sameOrigin(request))return reply(403,{});
  await authorize(deviceStoreFactory(),env,request.headers.get('authorization'));
  const text=await request.text();if(text.length>2000)throw Error('INVALID_SETTINGS');const input=JSON.parse(text),values=validateTradeSettings(input.values);
  lock=await leaseFactory(store,id);if(!lock)return reply(409,{error:'TRADE_IN_PROGRESS'});
  if(input.revision!==(lock.state.settingsRevision||0))return reply(409,{error:'SETTINGS_CHANGED_RELOAD'});
  lock.state.settings=values;lock.state.settingsRevision=(lock.state.settingsRevision||0)+1;await lock.save(lock.state);
  return reply(200,{revision:lock.state.settingsRevision,values});
 }catch(e){return reply(e.status||400,{error:e.code||e.message});}finally{if(lock)await lock.release();}
};
}
export default makeSettingsHandler();
