import {authorized,validateSubscription,validateEvent,deliver,hash} from '../../push/core.mjs';
const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
export default async function(request){
 try{
  const env=process.env,action=new URL(request.url).searchParams.get('action'),site=env.PUSH_SITE_URL||'https://levi-emptying-tracker.netlify.app';
  if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.PUSH_PAIRING_TOKEN||!env.PUSH_RELAY_TOKEN||!env.VAPID_SUBJECT)return reply(503,{error:'Push טרם הוגדר ב־Netlify'});
  if(action==='config'&&request.method==='GET')return reply(200,{publicKey:env.VAPID_PUBLIC_KEY});
  if(request.method!=='POST')return reply(405,{error:'Method not allowed'});
  if(!authorized(request,action==='publish'?env.PUSH_RELAY_TOKEN:env.PUSH_PAIRING_TOKEN))return reply(401,{error:'קוד הצמדה לא תקין'});
  if(action!=='publish'&&request.headers.get('origin')!==site)return reply(403,{error:'Same-origin only'});
  const raw=await request.text();if(Buffer.byteLength(raw)>5000)return reply(413,{error:'Too large'});const input=JSON.parse(raw);
  const {getStore}=await import('@netlify/blobs');const store=getStore({name:'levi-push-devices',consistency:'strong'});
  const slots=await Promise.all(Array.from({length:8},async(_,i)=>({key:'device-'+i,value:await store.get('device-'+i,{type:'json'})})));
  if(action==='subscribe'||action==='unsubscribe'||action==='test'){
   const subscription=validateSubscription(input.subscription),existing=slots.find(s=>s.value?.subscription.endpoint===subscription.endpoint);
   if(action==='unsubscribe'){if(existing)await store.delete(existing.key);return reply(200,{removed:true});}
   if(action==='subscribe'){
    if(existing)return reply(200,{subscribed:true});
    for(const slot of slots.filter(s=>!s.value)){const result=await store.setJSON(slot.key,{subscription},{onlyIfNew:true});if(result.modified)return reply(200,{subscribed:true});}
    return reply(409,{error:'רשימת המכשירים מלאה'});
   }
   if(!existing)return reply(404,{error:'הפעל התראות לפני הבדיקה'});
   const imported=await import('web-push'),webpush=imported.default||imported;webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);
   await webpush.sendNotification(subscription,JSON.stringify({title:'LEVI · בדיקת Push',body:'התראת בדיקה בלבד. לא בוצעה עסקה.',tag:'levi-test',url:'/push.html'}),{TTL:120,urgency:'high',timeout:7000});return reply(200,{accepted:true});
  }
  if(action!=='publish')return reply(404,{error:'Unknown action'});
  const event=validateEvent(input),devices=slots.filter(s=>s.value).map(s=>({key:s.key,subscription:s.value.subscription}));
  if(!devices.length)return reply(409,{error:'No paired devices'});
  const events=getStore({name:'levi-push-events',consistency:'strong'}),key=new Date(event.timestamp).toISOString().slice(0,10)+'/'+hash(event.id);
  const claim=await events.setJSON(key,{time:event.timestamp},{onlyIfNew:true});if(!claim.modified)return reply(200,{duplicate:true});
  const imported=await import('web-push'),webpush=imported.default||imported;webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);
  const result=await deliver(event,devices,(...args)=>webpush.sendNotification(...args),key=>store.delete(key));return reply(200,result);
 }catch{return reply(400,{error:'לא ניתן להשלים את בקשת ההתראות; בדוק את הגדרות השירות'});}
}
