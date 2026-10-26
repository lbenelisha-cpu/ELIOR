import {db} from './agent.mjs';
import {regularSession} from './colmex-market-hours.mjs';
export const stockSnapshotStore={
 async read(key){const rows=await db('paper_market_cache?key=eq.'+encodeURIComponent(key)+'&select=payload&limit=1');return rows?.[0]?.payload||null;},
 async write(key,payload){await db('paper_market_cache?on_conflict=key',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({key,payload,expires_at:new Date(Date.parse(payload.savedAt)+7*86400000).toISOString(),lease_until:null})});}
};
export async function cachedStockRead({key,fetchData,validate,store=stockSnapshotStore,now=Date.now(),freshMs=0}){
 let saved=null;try{saved=await store.read(key);}catch{}
 const age=now-Date.parse(saved?.savedAt),usable=saved&&Number.isFinite(age)&&age>=0&&age<7*86400000&&validate(saved.data);
 const fromCache=(reason,error=null)=>({...saved.data,cacheState:reason,snapshotAt:saved.savedAt,providerErrorCode:['RATE_LIMIT','NETWORK','TOKEN_EXPIRED','AUTH_DENIED','ACCESS_DENIED','BROKER_NOT_READY','BROKER_ERROR_RESPONSE','SESSION_BUSY','SESSION_STORE_UNAVAILABLE'].includes(error?.code)?error.code:null,notice:(saved.data.notice||'נתוני ספק; ייתכן עיכוב.')+(reason==='MARKET_CLOSED_CACHE'?' · מחוץ לשעות המסחר: מוצגים נתונים שמורים.':' · הספק אינו זמין כרגע: מוצג העותק התקין האחרון, עם זמן הנתון המקורי.')});
 if(usable&&age<freshMs)return {...saved.data,cacheState:'RECENT_CACHE',snapshotAt:saved.savedAt};
 if(usable&&!regularSession(now)&&age<6*3600000)return fromCache('MARKET_CLOSED_CACHE');
 try{const data=await fetchData();if(!validate(data))throw Error('INVALID_SNAPSHOT');try{await store.write(key,{data,savedAt:new Date(now).toISOString()});}catch{}return {...data,cacheState:'PROVIDER',snapshotAt:new Date(now).toISOString()};}
 catch(error){if(usable)return fromCache('PROVIDER_UNAVAILABLE_CACHE',error);throw error;}
}
export function validStockSnapshot(data,symbol,interval=null,source='Twelve Data'){
 if(data?.symbol!==symbol||data.currency!=='USD'||data.source!==source||!Number.isFinite(data.price)||data.price<=0)return false;
 if(interval===null)return true;
 return data.interval===interval&&Array.isArray(data.bars)&&data.bars.length>0&&data.bars.every(b=>Number.isFinite(Date.parse(b.date))&&['open','high','low','close'].every(k=>Number.isFinite(b[k])&&b[k]>0)&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close));
}
