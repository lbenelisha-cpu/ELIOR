/* Explicit user actions only. No automatic order retries. */
(()=>{
 const get=id=>document.getElementById(id),dialog=get('manualTradeDialog');if(!dialog)return;
 let intent=null,busy=false,uncertain=false,selectedAtOpen=null;
 const context=()=>window.LEVI_MANUAL_TRADES?.context()||{};
 function refresh(){
  const c=context(),ready=c.mode==='live'&&c.capabilities?.version===1,held=c.account?.balances?.find(b=>b.asset+'USDT'===c.symbol);
  if(get('manualShortOpenBtn'))get('manualShortOpenBtn').disabled=busy||uncertain||c.mode!=='live'||c.futuresCapabilities?.version!==1;
  if(get('manualShortCloseBtn'))get('manualShortCloseBtn').disabled=busy||uncertain||c.mode!=='live'||c.futuresCapabilities?.version!==1||!c.futures?.positions?.some(p=>p.symbol===c.symbol);
  get('manualForgetBtn').disabled=busy||uncertain;get('manualBuyBtn').disabled=busy||!ready;const sellable=Number(held?.qty??(Number(held?.free||0)+Number(held?.locked||0)))>0;get('manualSellBtn').disabled=busy||!ready||!sellable;get('manualSellBtn').title=!ready?'נדרש מצב LIVE וחיבור מכשיר מאושר':sellable?'מכור מיד את כל הכמות הזמינה של '+c.symbol:'אין יתרה זמינה למכירה בנכס '+c.symbol;
  get('manualTradeHint').textContent=!ready?(c.mode!=='live'?'קנייה ומכירה ידניות זמינות ב־LIVE בלבד':'נדרש עדכון שרת להפעלת קנייה ומכירה ידניות'):'מסחר באישור שלך · '+c.symbol+' · בדיקת פרטים ואישור לפני כל פעולה';
 }
 function close(){if(!busy&&!uncertain){dialog.close();intent=null;}}
 function open(side,symbol=null,market='SPOT'){
  if(busy||uncertain||dialog.open)return;
  const base=context(),futures=market==='FUTURES';if(!['SPOT','FUTURES'].includes(market))return;
  const c={...base,symbol:symbol||base.symbol,capabilities:futures?base.futuresCapabilities:base.capabilities,account:futures?{usdtFree:base.futures?.account?.availableUsdt}:base.account};
  if(!/^[A-Z0-9]+USDT$/.test(c.symbol)||c.mode!=='live'||c.capabilities?.version!==1){get('manualTradeHint').textContent='פעולה זו דורשת מצב LIVE ושרת מעודכן למסלול שנבחר';return;}
  selectedAtOpen=base.symbol;
  if(window.LEVI_MANUAL_TRADES.connected?.()===false){window.LEVI_MANUAL_TRADES.connect();return;}
  const bal=c.account?.balances?.find(b=>b.asset+'USDT'===c.symbol);
  intent={requestId:crypto.randomUUID(),symbol:c.symbol,side:futures?(side==='BUY'?'OPEN_SHORT':'CLOSE_SHORT'):side,market,mode:'live',all:side==='SELL'};uncertain=false;
  get('manualTradeTitle').textContent=(side==='BUY'?'קנייה ידנית · ':'מכירת כל הכמות · ')+c.symbol+' · LIVE';
  get('manualAmountRow').hidden=side!=='BUY';get('manualQuoteAmount').value='';
  get('manualTradeSummary').textContent=side==='BUY'?'יתרה זמינה: '+Number(c.account?.usdtFree||0).toLocaleString('he-IL',{maximumFractionDigits:8})+' USDT · תקרה לפעולה: '+c.capabilities.maxOrderUsdt+' USDT. קנייה ידנית פותחת פוזיציה חדשה, ללא המתנה לאישור וואיקוף.':'תימכר כל הכמות הזמינה של '+c.symbol+': '+Number(bal?.qty??(Number(bal?.free||0)+Number(bal?.locked||0))).toLocaleString('he-IL',{maximumFractionDigits:12})+'. השרת ישחרר הגנות שהבוט מנהל לפני המכירה. נעילות אחרות לא יבוטלו; עשויה להישאר שארית קטנה עקב מגבלות בייננס.';
  get('manualTradePolicy').textContent=side==='BUY'?'לאחר הביצוע יחולו חוקי המכירה שנשמרו ב־SETTINGS, כולל יעד הרווח והסטופ. נדרש מקום פנוי מתוך '+c.capabilities.maxPositions+' פוזיציות.':'זו מכירה ידנית מיידית של המטבע הזה, גם לפני תום תקופת ההחזקה. קנייה אוטומטית חוזרת תדרוש תבנית וואיקוף חדשה.';
  get('manualTradeResult').textContent='המחיר ייקבע בזמן ביצוע פקודת השוק. לא נשלחה עסקה.';
  get('manualTradeSubmit').textContent=side==='BUY'?'אני מאשר קנייה בכסף אמיתי':'אני מאשר מכירה בכסף אמיתי';get('manualTradeSubmit').hidden=false;
  if(futures){get('manualTradeTitle').textContent=(side==='BUY'?'פתיחת שורט · ':'סגירת שורט · ')+c.symbol+' · Futures LIVE';get('manualTradeSummary').textContent=side==='BUY'?'פתיחת SHORT בלבד · עד 35 USDT כולל רזרבה · Isolated 1x. המחיר והכמות יאומתו לפני שליחה.':'סגירת פוזיציית SHORT של האפליקציה בנכס זה בלבד, בפקודת קנייה reduce-only. אין מכירת Spot.';get('manualTradePolicy').textContent='סטופ ויעד לפי הגדרות האפליקציה. כל מגבלות החשבון וההגנות נשמרות.';get('manualTradeSubmit').textContent=side==='BUY'?'אני מאשר פתיחת שורט בכסף אמיתי':'אני מאשר סגירת שורט בכסף אמיתי';}
  get('manualTradeCheck').hidden=true;get('manualTradeCancel').disabled=false;dialog.showModal();if(side==='BUY')get('manualQuoteAmount').focus();
 }
 async function send(check=false){
  if(busy||!intent)return;const base=context(),c=intent.market==='FUTURES'?{...base,capabilities:base.futuresCapabilities,account:{usdtFree:base.futures?.account?.availableUsdt}}:base;if(!check&&(c.mode!==intent.mode||c.symbol!==selectedAtOpen)){get('manualTradeResult').textContent='המטבע או מצב החשבון השתנו. סגור ופתח את חלון הפעולה מחדש.';return;}
  if(!check&&['BUY','OPEN_SHORT'].includes(intent.side)){
   const amount=Number(get('manualQuoteAmount').value);if(!Number.isFinite(amount)||amount<5){get('manualTradeResult').textContent='יש להזין סכום של לפחות 5 USDT';return;}
   if(amount>Number(c.capabilities.maxOrderUsdt)||intent.market!=='FUTURES'&&amount*1.002>Number(c.account?.usdtFree)){get('manualTradeResult').textContent='הסכום חורג מהיתרה הזמינה לאחר שמירת עמלה, או מתקרת הפעולה';return;}
   intent.quoteUsdt=amount;
  }
  busy=true;get('manualTradeSubmit').disabled=true;get('manualTradeCheck').disabled=true;get('manualTradeCancel').disabled=true;get('manualQuoteAmount').disabled=true;refresh();
  get('manualTradeResult').textContent=check?'בודק את אותה בקשה; לא נשלחת פקודה חדשה…':'שולח בקשה מאומתת לשרת…';
  try{
   const result=await window.LEVI_MANUAL_TRADES.submit({...intent,statusOnly:check});
   if(result===null){get('manualTradeResult').textContent='הפעולה בוטלה לפני שליחה';get('manualTradeSubmit').hidden=false;return;}
   uncertain=result.uncertain===true||(check&&!result.ok&&!result.requestId);
   if(result.ok){get('manualTradeResult').textContent='בייננס החזירה סטטוס '+result.order.status+' · כמות שבוצעה: '+result.order.executedQty+' · מזהה הזמנה: '+result.order.orderId;get('manualTradeSubmit').hidden=true;get('manualTradeCheck').hidden=true;await window.LEVI_MANUAL_TRADES.refresh().catch(()=>{});}
   else{get('manualTradeResult').textContent=result.error||'הבקשה לא הושלמה';get('manualTradeCheck').hidden=!uncertain;get('manualTradeSubmit').hidden=uncertain;if(!uncertain)intent.requestId=crypto.randomUUID();}
  }catch(error){
   uncertain=true;get('manualTradeResult').textContent='לא התקבל אישור סופי: '+error.message+'. אין לשלוח עסקה חדשה; בדוק את מצב הבקשה.';get('manualTradeCheck').hidden=false;get('manualTradeSubmit').hidden=true;
  }finally{busy=false;get('manualTradeSubmit').disabled=false;get('manualTradeCheck').disabled=false;get('manualTradeCancel').disabled=uncertain;get('manualQuoteAmount').disabled=uncertain;refresh();}
 }
 if(get('manualShortOpenBtn'))get('manualShortOpenBtn').onclick=()=>open('BUY',null,'FUTURES');
 if(get('manualShortCloseBtn'))get('manualShortCloseBtn').onclick=()=>open('SELL',null,'FUTURES');
 window.LEVI_QUICK_TRADE=(side,symbol,market)=>open(side,symbol,market);
 get('manualBuyBtn').onclick=()=>open('BUY');get('manualSellBtn').onclick=()=>open('SELL');get('manualTradeSubmit').onclick=()=>send(false);get('manualTradeCheck').onclick=()=>send(true);get('manualTradeCancel').onclick=close;
 get('manualForgetBtn').onclick=async()=>{if(busy||uncertain)return;try{await window.LEVI_MANUAL_TRADES.forget();get('manualTradeHint').textContent='המכשיר נותק ממסחר';}catch{get('manualTradeHint').textContent='החיבור המקומי נמחק; לא ניתן לאשר ניתוק בשרת כעת.';}};
 dialog.addEventListener('cancel',event=>{if(busy||uncertain)event.preventDefault();});
 setInterval(refresh,1000);refresh();
})();
