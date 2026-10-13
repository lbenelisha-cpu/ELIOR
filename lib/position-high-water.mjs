// Observe exchange trade ticks after entry. Never lower a saved peak or reuse another entry's peak.
export function observePositionPeak(position,price,at,now=Date.now()){
 const time=Date.parse(at),entry=Date.parse(position?.entryAt),value=Number(price);
 if(!Number.isFinite(entry)||!Number.isFinite(time)||time<entry||time>now+5000||now-time>90000||!(value>0)||!Number.isFinite(value))return false;
 if(value<=Math.max(Number(position.peakPrice)||0,Number(position.entryPrice)||0))return false;
 position.peakPrice=value;position.peakAt=new Date(time).toISOString();return true;
}
export function confirmedRsiExit(evaluation,position,now=Date.now()){
 const r=evaluation?.strategy?.rsiExit;
 return evaluation?.rawDecision==='SELL'&&evaluation?.strategy?.exitReason==='BINANCE_RSI_14_FALLING'&&evaluation?.strategy?.entryAt===position?.entryAt&&r?.sell===true&&Number.isFinite(r.previous)&&Number.isFinite(r.current)&&r.previous-r.current>1e-8&&Number(r.signalTime)>Date.parse(position.entryAt)&&Number(r.signalTime)<=now&&now-Number(r.signalTime)<=300000;
}
