(function(global){
 'use strict';
 function levels(position){
  if(position?.exitPolicy!=='FIXED_TP4_SL1_V1')return null;
  const entry=Number(position.entryPrice),qty=Number(position.qty);
  if(!(entry>0&&qty>0&&Number.isFinite(entry)&&Number.isFinite(qty)))return null;
  return {entry,qty,target:entry*1.04,stop:entry*.99,profit:entry*qty*.04,loss:entry*qty*.01};
 }
 function render(host,position,currency){
  if(!host)return;
  const risk=levels(position),key=risk?JSON.stringify([risk.entry,risk.qty,currency]):'none';
  if(host._riskKey===key)return;host._riskKey=key;
  host.replaceChildren();host.hidden=!risk;if(!risk)return;
  host.className='trade-risk-table';host.setAttribute('aria-label','יעד רווח וסף הפסד לפוזיציה בפועל');
  const format=n=>n.toLocaleString('en-US',{maximumFractionDigits:n<1?8:4});
  const table=document.createElement('table'),caption=document.createElement('caption');caption.textContent='עסקה בפועל · '+currency+' · לפני עמלות';table.append(caption);
  for(const [name,price,amount,kind]of [['קנייה',risk.entry,null,'entry'],['יעד +4%',risk.target,risk.profit,'profit'],['סטופ −1%',risk.stop,-risk.loss,'loss']]){
   const tr=document.createElement('tr');tr.className=kind;
   for(const value of [name,format(price),amount===null?'כמות '+format(risk.qty):(amount>0?'+':'−')+format(Math.abs(amount))+' '+currency]){const td=document.createElement('td');td.textContent=value;tr.append(td);}table.append(tr);
  }
  const note=document.createElement('small');note.textContent='סכומים מתוכננים; הביצוע עלול לחרוג מהסף.';host.append(table,note);
 }
 global.LEVI_TRADE_RISK={levels,render};
})(globalThis);
