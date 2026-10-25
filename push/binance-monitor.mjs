import {hash} from './core.mjs';
const TEN_MINUTES=600000;
const stamp=value=>Date.parse(value);
const price=value=>Number(value).toLocaleString('he-IL',{maximumFractionDigits:10});
const clock=value=>new Date(value).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function binanceTradeEvents(snapshot,now=Date.now()){
 if(!Array.isArray(snapshot?.live))throw Error('INVALID_ACTION_LOG');
 return snapshot.live.filter(a=>['BUY','SELL'].includes(a.type)&&a.status==='FILLED'&&/^[A-Z0-9]+USDT$/.test(a.symbol)&&Number(a.price)>0&&Number.isFinite(Number(a.price))&&stamp(a.at)>=now-TEN_MINUTES&&stamp(a.at)<=now).map(a=>{
  const id='binance:live:'+a.type+':'+a.symbol+':'+(a.orderId??a.at),row=snapshot.netJournal?.live?.find(r=>r.symbol===a.symbol&&r.at===a.at),net=row?.netPnlUsdt;
  const details=[a.symbol,'מחיר '+price(a.price),Number(a.amountUsdt)>0?price(a.amountUsdt)+' USDT':'',clock(a.at)];
  if(a.type==='SELL')details.push(net!==null&&net!==undefined&&Number.isFinite(Number(net))?'נטו '+(net>=0?'+':'')+price(net)+' USDT':'רווח נטו אינו זמין ביומן');
  return {id,at:stamp(a.at),topic:'binance-trades',notification:{title:'LEVI · LIVE · '+(a.type==='BUY'?'קנייה בוצעה':'מכירה בוצעה'),body:details.filter(Boolean).join(' · '),tag:hash(id).slice(0,32),url:'/binance-agent.html'}};
 });
}
export function binanceSignalEvents(snapshot,now=Date.now()){
 if(snapshot?.mode!=='live')return [];
 return (snapshot.agents||[]).filter(a=>a.position!=='LONG'&&!a.staleData&&a.entryConfirmed===true&&/^[A-Z0-9]+USDT$/.test(a.symbol)).flatMap(a=>{
  const s=a.strategy||{},setup=s.setup||s,at=Number(s.signalTime||setup.signalTime||setup.confirmation?.time),pattern=s.patternId||setup.patternId;
  if(!pattern||!Number.isFinite(at)||at<now-TEN_MINUTES||at>now)return [];
  const id='binance:signal:'+a.symbol+':'+pattern;
  return [{id,at,topic:'binance-signals',notification:{title:'LEVI · וואיקוף אושר',body:a.symbol+' · אישור כניסה זוהה · '+clock(at)+' · זו אינה הודעת ביצוע קנייה.',tag:hash(id).slice(0,32),url:'/binance-agent.html'}}];
 });
}
export function deviceTopics(device){return Array.isArray(device.topics)?device.topics:['mt4'];}
export function pairedDevice(subscription,input,previous,now=Date.now()){
 const allowed=['binance-trades','binance-signals','mt4'];
 const topics=input.topics===undefined?deviceTopics(previous||{}):input.topics;
 if(!Array.isArray(topics)||!topics.length||topics.some(t=>!allowed.includes(t)))throw Error('בחר לפחות סוג התראה אחד');
 const old=deviceTopics(previous||{}),next={...previous,subscription,topics:[...new Set(topics)],pairedAt:previous?.pairedAt||now,updatedAt:now};
 for(const topic of ['binance-trades','binance-signals'])if(topics.includes(topic))next[topic+'-since']=old.includes(topic)&&Number(previous?.[topic+'-since'])>0?previous[topic+'-since']:now;
 return next;
}
// Per-event/per-device claims allow transient failures to retry without re-alerting
// devices already accepted by the push provider. Provider acceptance is not receipt.
export async function deliverBinanceEvents({events,devices,store,send,remove,now=Date.now()}){
 const stats={accepted:0,failed:0,expired:0,duplicates:0};
 const deadline=Date.now()+15000;
 await Promise.all(devices.map(async device=>{for(const event of events){
  if(Date.now()+6500>deadline)break;
  if(!deviceTopics(device).includes(event.topic)||event.at<Number(device[event.topic+'-since']||device.pairedAt||now))continue;
  const key='event/'+hash(event.id+':'+device.subscription.endpoint),old=await store.getWithMetadata(key,{type:'json'});
  if(old?.data?.status==='sent'||Number(old?.data?.leaseUntil)>now){stats.duplicates++;continue;}
  const claim=await store.setJSON(key,{status:'sending',leaseUntil:now+120000},{...(old?.etag?{onlyIfMatch:old.etag}:{onlyIfNew:true})});
  if(!claim.modified)continue;
  try{
   await send(device.subscription,JSON.stringify(event.notification),{TTL:300,urgency:'high',topic:event.notification.tag,timeout:6000});
   await store.setJSON(key,{status:'sent',at:event.at,acceptedAt:now});stats.accepted++;
  }catch(error){
   if([404,410].includes(error.statusCode)){await remove(device.key);await store.setJSON(key,{status:'sent',expired:true,at:now});stats.expired++;}
   else{await store.delete(key);stats.failed++;}
  }
 }}));
 return stats;
}
export async function pollBinanceNotifications({devices,store,fetcher=fetch,send,remove,readToken,now=Date.now()}){
 const active=devices.filter(d=>deviceTopics(d).some(t=>t.startsWith('binance-')));
 if(!active.length){await store.setJSON('status',{checkedAt:now,devices:0});return {devices:0};}
 const get=async path=>{const r=await fetcher('https://levi-binance.2-29-48-20.sslip.io'+path,{method:'GET',headers:{Accept:'application/json',Authorization:'Bearer '+readToken},redirect:'error',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('BINANCE_READ_UNAVAILABLE');return r.json();};
 try{
  if(typeof readToken!=='string'||!/^[-A-Za-z0-9._~]{32,512}$/.test(readToken))throw Error('BINANCE_PUSH_READ_TOKEN_REQUIRED');
  const [log,agents]=await Promise.all([get('/api/binance-action-log'),active.some(d=>deviceTopics(d).includes('binance-signals'))?get('/api/binance-agent'):null]);
  const events=[...binanceTradeEvents(log,now),...binanceSignalEvents(agents,now)].sort((a,b)=>a.at-b.at);
  const result=await deliverBinanceEvents({events,devices:active,store,send,remove,now});
  await store.setJSON('status',{checkedAt:now,devices:active.length,...result});return result;
 }catch(error){await store.setJSON('status',{checkedAt:now,devices:active.length,error:'BINANCE_READ_OR_PUSH_UNAVAILABLE'});throw error;}
}
