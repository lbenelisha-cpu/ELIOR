(function(root){
 const KEY='levi-binance-public-candles-v1',LIMIT=4,MAX_AGE=86400000;
 const valid=x=>x&&Number.isFinite(x.savedAt)&&x.savedAt<=Date.now()&&Date.now()-x.savedAt<MAX_AGE&&Array.isArray(x.candles)&&x.candles.length>0&&x.candles.length<=3500&&x.candles.every(c=>Number.isFinite(c.openTime)&&Number.isFinite(c.closeTime)&&c.openTime<=x.savedAt&&['open','high','low','close'].every(k=>Number.isFinite(c[k])&&c[k]>0)&&c.high>=Math.max(c.open,c.close)&&c.low<=Math.min(c.open,c.close));
 const readAll=()=>{try{const data=JSON.parse(root.localStorage.getItem(KEY)||'{}');return data&&typeof data==='object'&&!Array.isArray(data)?data:{};}catch{return {};}};
 root.LEVI_CHART_CACHE={
  read(key){const value=readAll()[key];return valid(value)?value:null;},
  write(key,data){const value={savedAt:Date.now(),visibleStartTime:Number(data.visibleStartTime)||0,candles:data.candles};if(!valid(value))return;const entries=Object.entries(readAll()).filter(([k,v])=>k!==key&&valid(v)).sort((a,b)=>b[1].savedAt-a[1].savedAt).slice(0,LIMIT-1);try{root.localStorage.setItem(KEY,JSON.stringify(Object.fromEntries([[key,value],...entries])));}catch{}}
 };
})(window);
