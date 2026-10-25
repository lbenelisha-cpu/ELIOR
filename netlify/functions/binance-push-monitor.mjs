import {getStore} from '@netlify/blobs';
import webpush from 'web-push';
import {pollBinanceNotifications} from '../../push/binance-monitor.mjs';
export default async function(){
 const env=process.env;if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT)return new Response(null,{status:204});
 const store=getStore({name:'levi-binance-push-monitor',consistency:'strong'}),subscriptions=getStore({name:'levi-push-devices',consistency:'strong'});
 const devices=(await Promise.all(Array.from({length:8},async(_,i)=>{const key='device-'+i,value=await subscriptions.get(key,{type:'json'});return value?{...value,key}:null;}))).filter(Boolean);
 webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);
 await pollBinanceNotifications({devices,store,readToken:env.BINANCE_PUSH_READ_TOKEN,send:(...args)=>webpush.sendNotification(...args),remove:key=>subscriptions.delete(key)});
 return new Response(null,{status:204});
}
export const config={schedule:'* * * * *'};
