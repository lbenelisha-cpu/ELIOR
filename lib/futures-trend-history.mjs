// Cache only public historical candles. Every call still reads the latest 5m bars.
// A reader/venue has its own bounded cache; no account or order state is shared.
const readers=new WeakMap(),HOUR=3600000;
export async function futuresTrendHistory(reader,symbol,now){
 let cache=readers.get(reader);if(!cache){cache=new Map();readers.set(reader,cache);}
 const bucket=Math.floor(now/HOUR),saved=cache.get(symbol),full=!saved||saved.bucket!==bucket;
 const get=typeof reader==='function'?reader:(path,params)=>reader.get(path,params);
 const rows=await get('/fapi/v1/klines',{symbol,interval:'5m',limit:full?1500:206});
 if(!Array.isArray(rows)||!rows.length||rows.some((r,i)=>!Array.isArray(r)||!Number.isFinite(Number(r[0]))||i&&Number(r[0])<=Number(rows[i-1][0])))throw Error('FUTURES_HISTORY_UNVERIFIED');
 const combined=full?rows:[...saved.rows.filter(r=>Number(r[0])<Number(rows[0][0])),...rows].slice(-1500);
 if(cache.size>=150&&!cache.has(symbol))cache.delete(cache.keys().next().value);
 cache.set(symbol,{bucket,rows:structuredClone(combined)});
 return combined;
}
