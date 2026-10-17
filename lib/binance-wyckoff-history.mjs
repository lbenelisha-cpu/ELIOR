import {scanWyckoffOccurrences,mergeWyckoffOccurrences,recordedWyckoffOccurrences} from './wyckoff-occurrences.mjs';
export function binanceWyckoffHistory(candles,rows=[],position={},now=Date.now()){
 const closed=candles.filter(b=>b.closed!==false&&Number(b.closeTime)<=now).map(b=>({open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close),closeTime:Number(b.closeTime),timeframe:'5m'}));
 let reconstructed=[],error=null;
 try{reconstructed=scanWyckoffOccurrences(closed,{now});}catch(e){error=e.message;}
 return {history:mergeBinanceRecorded(reconstructed,rows,position,now),error};
}
export function mergeBinanceRecorded(history,rows,position={},now=Date.now()){
 const setups=[...rows].filter(r=>r.analysisSignal===true||r.entryConfirmed===true||r.type==='BUY').sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).map(r=>r.setup||r.wyckoffTrade?.setup).filter(Boolean);
 if(position.setup)setups.push(position.setup);
 return mergeWyckoffOccurrences(history,recordedWyckoffOccurrences(setups),now);
}
export function visibleBinanceOccurrences(history,candles){
 return history.map(item=>({...item,index:candles.findIndex(b=>item.springAt>=Number(b.openTime)&&item.springAt<=Number(b.closeTime))})).filter(x=>x.index>=0).sort((a,b)=>a.springAt-b.springAt).map((item,i)=>({...item,number:i+1}));
}
