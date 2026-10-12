// Binance-only RSI exit. Signals use closed five-minute bars after entry.
export function binanceRsiExit(rows,{entryAt,now=Date.now(),period=14}={}){
 const hold=reason=>({sell:false,reason});
 const entryTime=Date.parse(entryAt);
 if(!Number.isFinite(entryTime))return hold('RSI_ENTRY_TIME_UNAVAILABLE');
 if(!Array.isArray(rows)||rows.length<period+2)return hold('RSI_WAIT_BARS');
 const bars=rows.filter(b=>b.closed!==false&&Number(b.closeTime)<=now);
 if(bars.length<period+2)return hold('RSI_WAIT_BARS');
 for(let i=0;i<bars.length;i++){
  if(!(Number(bars[i].close)>0)||!Number.isFinite(Number(bars[i].close)))return hold('RSI_INVALID_BARS');
  if(i&&Number(bars[i].closeTime)-Number(bars[i-1].closeTime)!==300000)return hold('RSI_INVALID_BARS');
 }
 const signalTime=Number(bars.at(-1).closeTime);
 if(now-signalTime>300000)return hold('RSI_STALE_BARS');
 if(signalTime<=entryTime)return hold('RSI_WAIT_POST_ENTRY_BAR');
 let gain=0,loss=0,previous=null,current=null;
 const strength=()=>gain===0&&loss===0?50:loss===0?100:100-100/(1+gain/loss);
 for(let i=1;i<bars.length;i++){
  const delta=Number(bars[i].close)-Number(bars[i-1].close);
  if(i<=period){gain+=Math.max(delta,0)/period;loss+=Math.max(-delta,0)/period;}
  else{gain=(gain*(period-1)+Math.max(delta,0))/period;loss=(loss*(period-1)+Math.max(-delta,0))/period;}
  if(i>=period){previous=current;current=strength();}
 }
 return {sell:current<previous,reason:current<previous?'BINANCE_RSI_14_FALLING':'RSI_HOLD',previous,current,signalTime,period};
}
