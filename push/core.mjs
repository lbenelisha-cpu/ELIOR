import {createHash,timingSafeEqual} from 'node:crypto';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export function authorized(request,token){const supplied=Buffer.from((request.headers.get('authorization')||'').replace(/^Bearer /,'')),expected=Buffer.from(token||'');return expected.length>=24&&supplied.length===expected.length&&timingSafeEqual(supplied,expected);}
export function validateSubscription(value){
 const url=new URL(value?.endpoint);const host=url.hostname;
 if(url.protocol!=='https:'||url.username||url.password||url.port||value.endpoint.length>2048||!(['web.push.apple.com','fcm.googleapis.com','updates.push.services.mozilla.com'].includes(host)||/^[a-z0-9-]+\.push\.apple\.com$/.test(host)))throw Error('Unsupported push endpoint');
 if(!/^[A-Za-z0-9_-]+$/.test(value.keys?.p256dh||'')||Buffer.from(value.keys.p256dh,'base64url').length!==65||!/^[A-Za-z0-9_-]+$/.test(value.keys?.auth||'')||Buffer.from(value.keys.auth,'base64url').length!==16)throw Error('Invalid subscription key');
 return {endpoint:value.endpoint,keys:{p256dh:value.keys.p256dh,auth:value.keys.auth}};
}
export function validateEvent(value,now=Date.now()){
 if(!value||typeof value.id!=='string'||value.id.length>160||!Number.isFinite(value.timestamp)||Math.abs(now-value.timestamp)>120000||!['positive','negative','risk','disconnected','portfolio-risk'].includes(value.type)||typeof value.symbol!=='string'||!/^[A-Za-z0-9#_.&-]{0,64}$/.test(value.symbol))throw Error('Invalid or expired alert');
 return {id:value.id,timestamp:value.timestamp,type:value.type,symbol:value.symbol};
}
export function notification(event){const titles={positive:'איתות קנייה טכני',negative:'איתות שלילי',risk:'סיכון מוגבר בנוסחה',disconnected:'נתוני MT4 אינם זמינים','portfolio-risk':'סף סיכון תיק המעקב נחצה'};return {title:'LEVI · '+titles[event.type],body:event.symbol?event.symbol+' · פתח את האפליקציה במחשב לבדיקה. לא בוצעה עסקה.':'פתח את האפליקציה במחשב ובדוק את מצב המעקב. לא בוצעה עסקה.',tag:hash(event.id).slice(0,32),url:'/push.html'};}
export async function deliver(event,devices,send,remove){let accepted=0,failed=0;for(const device of devices){try{await send(device.subscription,JSON.stringify(notification(event)),{TTL:120,urgency:'high',topic:hash(event.id).slice(0,32),timeout:7000});accepted++;}catch(error){failed++;if([404,410].includes(error.statusCode))await remove(device.key);}}return {accepted,failed};}
