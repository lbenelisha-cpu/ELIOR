(function(global){
 'use strict';
 function levels(position){
  if(!['FIXED_TP4_SL1_V1','PROFIT_FLOOR4_TRAIL1PP_STOP1_V1','PROFIT_ACTIVATE5_TRAIL1PP_STOP1_V2'].includes(position?.exitPolicy)&&position?.displayOnly!==true)return null;
  const entry=Number(position.entryPrice),qty=Number(position.qty);
  if(!(entry>0&&qty>0&&Number.isFinite(entry)&&Number.isFinite(qty)))return null;
  const current=Number(position.currentPrice),pnl=Number(position.pnlIls);
  const tp=Number(position.takeProfitPct??50),sl=Number(position.stopLossPct??1),activation=Number(position.profitActivationPct??(position.exitPolicy==='PROFIT_ACTIVATE5_TRAIL1PP_STOP1_V2'?5:4)),gap=Number(position.trailingGapPp??1);
  const trailing=['PROFIT_FLOOR4_TRAIL1PP_STOP1_V1','PROFIT_ACTIVATE5_TRAIL1PP_STOP1_V2'].includes(position.exitPolicy),peak=Math.max(entry,Number(position.peakPrice)||entry),armed=trailing&&(position.profitFloorArmed===true||peak>=entry*(1+activation/100));
  const stop=trailing?Math.max(entry*(1-sl/100),Number(position.effectiveStopPrice)||0,armed?Math.max(position.exitPolicy==='PROFIT_FLOOR4_TRAIL1PP_STOP1_V1'?entry*(1+activation/100):0,peak-entry*gap/100):0):entry*(1-sl/100);
  return {brokerProtection:position.brokerProtection||null,tp,sl,activation,gap,brokerTarget:entry*(1+tp/100),entry,qty,target:entry*(1+activation/100),stop,peak,trailing,armed,protectedPnl:(stop-entry)*qty,profit:entry*qty*activation/100,loss:entry*qty*sl/100,displayOnly:position.displayOnly===true,current:current>0&&Number.isFinite(current)?current:null,pnl:position.pnlIls!=null&&Number.isFinite(pnl)?pnl:current>0&&Number.isFinite(current)?(current-entry)*qty:null};
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
  rows.push([risk.displayOnly?'המחשה +4%':risk.trailing?'הפעלת הגנה +'+risk.activation+'%':'יעד +4%',risk.target,risk.profit,'profit']);
  if(risk.trailing&&!risk.displayOnly)rows.push(['Take Profit +'+risk.tp+'%',risk.brokerTarget,(risk.brokerTarget-risk.entry)*risk.qty,'profit']);
  if(risk.trailing)rows.push(['שיא מאז הקנייה',risk.peak,(risk.peak-risk.entry)*risk.qty,'profit']);
  rows.push([risk.displayOnly?'המחשה −1%':risk.armed?'סף נגרר +'+format((risk.stop/risk.entry-1)*100)+'%':'סטופ −'+risk.sl+'%',risk.stop,risk.trailing?risk.protectedPnl:-risk.loss,risk.armed?'profit':'loss']);
  for(const [name,price,amount,kind]of rows){
   const tr=document.createElement('tr');tr.className=kind;
   for(const value of [name,format(price),amount===null?'כמות '+format(risk.qty):(amount>0?'+':'−')+format(Math.abs(amount))+' '+currency]){const td=document.createElement('td');td.textContent=value;tr.append(td);}table.append(tr);
  }
  const note=document.createElement('small');note.textContent=risk.displayOnly?'ללא ניהול אוטומטי; היעדים אינם הוראות מסחר.':risk.trailing?'הגנה מ־'+risk.activation+'%; מרחק נגרר '+risk.gap+' נקודות אחוז; יעד '+risk.tp+'%. לפני עמלות; ביצוע אינו מובטח.':'סכומים מתוכננים לפני עמלות; הביצוע עלול לחרוג מהסף.';if(risk.brokerProtection)note.textContent+=' · הגנה בבייננס: '+({MISSING:'טרם אושרה',ACTIVE:'אושרה',CREATING:'ממתינה לאישור',CANCELING:'ביטול נבדק',REJECTED:'נדחתה'}[risk.brokerProtection.status]||risk.brokerProtection.status);host.append(table,note);
 }
 global.LEVI_TRADE_RISK={levels,render};
})(globalThis);
