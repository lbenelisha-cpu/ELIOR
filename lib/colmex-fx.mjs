import {td} from './agent.mjs';
export function validRate(q,now=Date.now()/1000){
 return q?.symbol==='USD/ILS'&&typeof q.rate==='number'&&Number.isFinite(q.rate)&&q.rate>0&&typeof q.timestamp==='number'&&Number.isFinite(q.timestamp)&&q.timestamp<=now+5&&now-q.timestamp<=60;
}
export function brokerRate(items={},now=Date.now()/1000){
 const q=['USDILS#','USDILS'].map(s=>items[s]).filter(x=>x&&Number.isFinite(x.bid)&&Number.isFinite(x.ask)&&x.bid>0&&x.ask>=x.bid&&Number.isFinite(x.tickTime)&&now-x.tickTime<=60&&x.tickTime<=now+5&&Number.isFinite(x.capturedAt)&&now-x.capturedAt<=180&&x.capturedAt<=now+5).sort((a,b)=>b.tickTime-a.tickTime)[0];
 return q?{symbol:'USD/ILS',rate:q.bid,timestamp:q.tickTime,source:'MT4 · '+q.symbol}:null;
}
export async function thresholdRate(items={},request=td,clock=()=>Date.now()/1000){
 const broker=brokerRate(items,clock());if(broker)return broker;
 try{
  // Use the provider's rate timestamp, never the time the response was downloaded.
  const d=await request('exchange_rate',{symbol:'USD/ILS'},60);
  const q={symbol:d.symbol,rate:Number(d.rate),timestamp:d.timestamp,source:'Twelve Data'};
  if(validRate(q,clock()))return q;
  return {source:'Twelve Data',error:'שער חלופי חסר, לא תקין או ישן מ־60 שניות'};
 }catch{return {source:'Twelve Data',error:'שער חלופי אינו זמין כרגע; בדוק מכסה, הרשאת ספק והגדרת TWELVE_DATA_API_KEY'};}
}
