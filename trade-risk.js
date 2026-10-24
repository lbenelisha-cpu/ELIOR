(function(global){
 'use strict';
 function levels(position){
  if(!['FIXED_TP4_SL1_V1','PROFIT_FLOOR4_TRAIL1PP_STOP1_V1'].includes(position?.exitPolicy)&&position?.displayOnly!==true)return null;
  const entry=Number(position.entryPrice),qty=Number(position.qty);
  if(!(entry>0&&qty>0&&Number.isFinite(entry)&&Number.isFinite(qty)))return null;
  const current=Number(position.currentPrice),pnl=Number(position.pnlIls);
  const trailing=position.exitPolicy==='PROFIT_FLOOR4_TRAIL1PP_STOP1_V1',peak=Math.max(entry,Number(position.peakPrice)||entry),armed=trailing&&(position.profitFloorArmed===true||peak>=entry*1.04);
  const stop=trailing?Math.max(entry*.99,Number(position.effectiveStopPrice)||0,armed?Math.max(entry*1.04,peak-entry*.01):0):entry*.99;
  return {entry,qty,target:entry*1.04,stop,peak,trailing,armed,protectedPnl:(stop-entry)*qty,profit:entry*qty*.04,loss:entry*qty*.01,displayOnly:position.displayOnly===true,current:current>0&&Number.isFinite(current)?current:null,pnl:position.pnlIls!=null&&Number.isFinite(pnl)?pnl:current>0&&Number.isFinite(current)?(current-entry)*qty:null};
 }
 function render(host,position,currency){
  if(!host)return;
  const risk=levels(position),key=risk?JSON.stringify([risk,currency]):'none';
  if(host._riskKey===key)return;host._riskKey=key;
  host.replaceChildren();host.hidden=!risk;if(!risk)return;
  host.className='trade-risk-table';host.setAttribute('aria-label','יעד רווח וסף הפסד לפוזיציה בפועל');
  const format=n=>n.toLocaleString('en-US',{maximumFractionDigits:n<1?8:4});
  const table=document.createElement('table'),caption=document.createElement('caption');caption.textContent=(risk.displayOnly?'החזקה ידנית · יעדים להמחשה':'עסקה מנוהלת')+' · '+currency;table.append(caption);
  const rows=[['מחיר עלות',risk.entry,null,'entry']];
  if(risk.current!==null)rows.push(['רווח / הפסד כעת',risk.current,risk.pnl,risk.pnl>=0?'profit':'loss']);
  rows.push([risk.displayOnly?'המחשה +4%':risk.trailing?'הפעלת הגנה +4%':'יעד +4%',risk.target,risk.profit,'profit']);
  if(risk.trailing)rows.push(['שיא מאז הקנייה',risk.peak,(risk.peak-risk.entry)*risk.qty,'profit']);
  rows.push([risk.displayOnly?'המחשה −1%':risk.armed?'סף נגרר +'+format((risk.stop/risk.entry-1)*100)+'%':'סטופ −1%',risk.stop,risk.trailing?risk.protectedPnl:-risk.loss,risk.armed?'profit':'loss']);
  for(const [name,price,amount,kind]of rows){
   const tr=document.createElement('tr');tr.className=kind;
   for(const value of [name,format(price),amount===null?'כמות '+format(risk.qty):(amount>0?'+':'−')+format(Math.abs(amount))+' '+currency]){const td=document.createElement('td');td.textContent=value;tr.append(td);}table.append(tr);
  }
  const note=document.createElement('small');note.textContent=risk.displayOnly?'ללא ניהול אוטומטי; היעדים אינם הוראות מסחר.':risk.trailing?'אין מכירה בהגעה ל־4%; נגרר נקודת אחוז. לפני עמלות; ביצוע אינו מובטח.':'סכומים מתוכננים לפני עמלות; הביצוע עלול לחרוג מהסף.';host.append(table,note);
 }
 global.LEVI_TRADE_RISK={levels,render};
})(globalThis);
