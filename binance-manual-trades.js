/* Explicit user actions only. No automatic order retries. */
(()=>{
 const get=id=>document.getElementById(id),dialog=get('manualTradeDialog');if(!dialog)return;
 let intent=null,busy=false,uncertain=false;
 const context=()=>window.LEVI_MANUAL_TRADES?.context()||{};
 function refresh(){
  const c=context(),ready=c.mode==='live'&&c.capabilities?.version===1,held=c.account?.balances?.find(b=>b.asset+'USDT'===c.symbol);
  get('manualBuyBtn').disabled=busy||!ready;get('manualSellBtn').disabled=busy||!ready||!(Number(held?.free)>0);
  get('manualTradeHint').textContent=!ready?(c.mode!=='live'?'קנייה ומכירה ידניות זמינות ב־LIVE בלבד':'נדרש עדכון שרת להפעלת קנייה ומכירה ידניות'):'פעולה ידנית במטבע הנבחר: '+c.symbol+' · פקודת שוק';
 }
 function close(){if(!busy&&!uncertain){dialog.close();intent=null;}}
 function open(side){
  const c=context();if(c.mode!=='live'||c.capabilities?.version!==1)return;
  const bal=c.account?.balances?.find(b=>b.asset+'USDT'===c.symbol);
  intent={requestId:crypto.randomUUID(),symbol:c.symbol,side,mode:'live',all:side==='SELL'};uncertain=false;
  get('manualTradeTitle').textContent=(side==='BUY'?'קנייה ידנית · ':'מכירת כל הכמות · ')+c.symbol+' · LIVE';
  get('manualAmountRow').hidden=side!=='BUY';get('manualQuoteAmount').value='';
  get('manualTradeSummary').textContent=side==='BUY'?'יתרה זמינה: '+Number(c.account?.usdtFree||0).toLocaleString('he-IL',{maximumFractionDigits:8})+' USDT · תקרה לפעולה: '+c.capabilities.maxOrderUsdt+' USDT. קנייה ידנית פותחת פוזיציה חדשה, ללא המתנה לאישור וואיקוף.':'תימכר כל הכמות הזמינה של '+c.symbol+': '+Number(bal?.free||0).toLocaleString('he-IL',{maximumFractionDigits:12})+'. כמות נעולה אינה זמינה; עשויה להישאר שארית קטנה עקב מגבלות בייננס.';
  get('manualTradePolicy').textContent=side==='BUY'?'לאחר הביצוע יחולו חוקי המכירה הקיימים: עצירה 10% ממחיר הקנייה והגנת רווח לאחר 7 ימים. נדרש מקום פנוי מתוך '+c.capabilities.maxPositions+' פוזיציות.':'זו מכירה ידנית מיידית של המטבע הזה, גם לפני תום תקופת ההחזקה. קנייה אוטומטית חוזרת תדרוש תבנית וואיקוף חדשה.';
  get('manualTradeResult').textContent='המחיר ייקבע בזמן ביצוע פקודת השוק. לא נשלחה עסקה.';
  get('manualTradeSubmit').textContent=side==='BUY'?'אשר קנייה ב־LIVE':'אשר מכירת כל הכמות ב־LIVE';get('manualTradeSubmit').hidden=false;
  get('manualTradeCheck').hidden=true;get('manualTradeCancel').disabled=false;dialog.showModal();if(side==='BUY')get('manualQuoteAmount').focus();
 }
 async function send(check=false){
  if(busy||!intent)return;const c=context();if(!check&&(c.mode!==intent.mode||c.symbol!==intent.symbol)){get('manualTradeResult').textContent='המטבע או מצב החשבון השתנו. סגור ופתח את חלון הפעולה מחדש.';return;}
  if(!check&&intent.side==='BUY'){
   const amount=Number(get('manualQuoteAmount').value);if(!Number.isFinite(amount)||amount<5){get('manualTradeResult').textContent='יש להזין סכום של לפחות 5 USDT';return;}
   if(amount>Number(c.capabilities.maxOrderUsdt)||amount*1.002>Number(c.account?.usdtFree)){get('manualTradeResult').textContent='הסכום חורג מהיתרה הזמינה לאחר שמירת עמלה, או מתקרת הפעולה';return;}
   intent.quoteUsdt=amount;
  }
  busy=true;get('manualTradeSubmit').disabled=true;get('manualTradeCheck').disabled=true;get('manualTradeCancel').disabled=true;get('manualQuoteAmount').disabled=true;refresh();
  get('manualTradeResult').textContent=check?'בודק את אותה בקשה; לא נשלחת פקודה חדשה…':'שולח בקשה מאומתת לשרת…';
  try{
   const result=await window.LEVI_MANUAL_TRADES.submit({...intent,statusOnly:check});
   if(result===null){get('manualTradeResult').textContent='הפעולה בוטלה לפני שליחה';return;}
   uncertain=result.uncertain===true||(check&&!result.ok&&!result.requestId);
   if(result.ok){get('manualTradeResult').textContent='בייננס החזירה סטטוס '+result.order.status+' · כמות שבוצעה: '+result.order.executedQty+' · מזהה הזמנה: '+result.order.orderId;get('manualTradeSubmit').hidden=true;get('manualTradeCheck').hidden=true;await window.LEVI_MANUAL_TRADES.refresh().catch(()=>{});}
   else{get('manualTradeResult').textContent=result.error||'הבקשה לא הושלמה';get('manualTradeCheck').hidden=!uncertain;get('manualTradeSubmit').hidden=uncertain;if(!uncertain)intent.requestId=crypto.randomUUID();}
  }catch(error){
   uncertain=true;get('manualTradeResult').textContent='לא התקבל אישור סופי: '+error.message+'. אין לשלוח עסקה חדשה; בדוק את מצב הבקשה.';get('manualTradeCheck').hidden=false;get('manualTradeSubmit').hidden=true;
  }finally{busy=false;get('manualTradeSubmit').disabled=false;get('manualTradeCheck').disabled=false;get('manualTradeCancel').disabled=uncertain;get('manualQuoteAmount').disabled=uncertain;refresh();}
 }
 get('manualBuyBtn').onclick=()=>open('BUY');get('manualSellBtn').onclick=()=>open('SELL');get('manualTradeSubmit').onclick=()=>send(false);get('manualTradeCheck').onclick=()=>send(true);get('manualTradeCancel').onclick=close;
 dialog.addEventListener('cancel',event=>{if(busy||uncertain)event.preventDefault();});
 setInterval(refresh,1000);refresh();
})();
