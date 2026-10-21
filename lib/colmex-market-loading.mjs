// Coordinate chart and background quote reads without changing trading execution.
export function createMarketLoadGate(now=Date.now){
 const pending=new Set(),retries=new Map();let quietUntil=0;
 return {
  begin(key){if(pending.size||now()<(retries.get(key)||0))return false;pending.add(key);quietUntil=now()+15000;return true;},
  finish(key,success,retryMs=65000){pending.delete(key);if(success){retries.delete(key);quietUntil=now()+1500;}else{const delay=Number.isFinite(retryMs)?Math.min(86400000,Math.max(65000,retryMs)):65000;retries.set(key,now()+delay);quietUntil=now()+65000;}},
  retryAt:key=>retries.get(key)||0,
  quoteAllowed:()=>pending.size===0&&now()>=quietUntil
 };
}
