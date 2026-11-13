import {entryReasonLabel} from './lib/colmex-entry-reasons.mjs?v=20261110-direction-confirmation';
const $=id=>document.getElementById(id),TOKEN_KEY='levi-colmex-device-v1',PENDING_KEY='levi-colmex-manual-pending-v1';
let token=null,pending=null,busy=false,diagnosticReviewId=null,reviewReleaseId=null;
try{token=localStorage.getItem(TOKEN_KEY);pending=JSON.parse(localStorage.getItem(PENDING_KEY)||'null');}catch{}
const messages={DEVICE_REQUIRED:'יש לחבר את המכשיר פעם אחת בקוד קצר.',PAIRING_NOT_CONFIGURED:'יש להגדיר ב־Netlify קוד חיבור קבוע COLMEX_DEVICE_PAIR_CODE בן 6 ספרות ולפרסם מחדש.',PAIR_CODE_INVALID:'קוד החיבור אינו נכון.',PAIR_CODE_EXPIRED_OR_USED:'קוד החיבור אינו פעיל. בדוק את הגדרת השרת.',PAIR_CODE_COOLDOWN:'יותר מדי ניסיונות. אפשר להשתמש באותו קוד שוב בעוד 15 דקות.',PAIR_CODE_RETRY:'בקשת חיבור נוספת מתבצעת. נסה שוב.',TRADE_IN_PROGRESS:'פעולת מסחר אחרת מתבצעת. המתן לסיומה.',LIVE_NOT_ENABLED:'מסחר LIVE אינו מופעל בשרת.',INVALID_BUY_AMOUNT:'יש להזין סכום חיובי; הכמות מוגבלת למזומן הפנוי אצל הברוקר.',NO_FREE_SLOT:'כל שלוש הפוזיציות תפוסות.',NO_UNIQUE_LONG_POSITION:'לא נמצאה פוזיציית LONG יחידה במניה זו.',MINIMUM_QUANTITY_ABOVE_BUDGET:'הכמות המינימלית יקרה מהסכום שבחרת.',INSUFFICIENT_UNLEVERAGED_CASH:'אין די מזומן לקנייה ולרזרבה של 5 דולר.',OUTSIDE_REGULAR_SESSION:'קנייה זמינה בשעות המסחר הרגילות בארה״ב.',EXISTING_POSITION_OR_ORDER:'קיימת פוזיציה או הוראה במניה שמונעת את הפעולה.',INSTRUMENT_UNAVAILABLE:'המניה אינה זמינה באופן חד־משמעי אצל הברוקר.',REQUIRES_REVIEW:'פעולה קודמת דורשת בדיקה אצל הברוקר.',BROKER_BRACKET_PERMISSION_REQUIRED:'נדרשות הרשאות מסחר וסטופ אצל הברוקר.'};
Object.assign(messages,{INVALID_DIAGNOSTIC_REQUEST:'בדיקת קנייה מותרת עד 200 דולר בלבד.',DIAGNOSTIC_STATE_CHANGED:'מצב ההוראה שבבירור השתנה או אינו מאפשר בדיקה נפרדת. לא נשלחה קנייה.',DIAGNOSTIC_ALREADY_USED:'כבר תועד ניסיון בדיקה עבור ההוראה שבבירור. אין לשלוח ניסיון נוסף.',DIAGNOSTIC_SAME_INSTRUMENT:'יש לבחור מניה אחרת מזו שההוראה שלה בבירור.',DIAGNOSTIC_ACCOUNT_NOT_EMPTY:'בדיקה נפרדת דורשת חשבון ללא פוזיציות או הוראות פתוחות והיסטוריה זמינה.'});
Object.assign(messages,{INVALID_DIAGNOSTIC_REQUEST:'נדרשת קנייה של מניה אחת בכפוף למזומן פנוי.',SINGLE_SHARE_UNAVAILABLE:'כללי הברוקר או התקציב אינם מאפשרים קניית מניה אחת.',BROKER_TAG_COLLISION:'תגית המעקב כבר קיימת. לא נשלחה הוראה.'});
const explain=code=>messages[code]||entryReasonLabel(code);
const brokerHints={SESSION:'חיבור או סשן',PERMISSION:'הרשאות',FUNDS:'יתרה או בטחונות',ORDER_PARAMETERS:'פרטי ההוראה',MARKET_CLOSED:'שעות המסחר',UNCLASSIFIED:'סיבה שלא סווגה'};
const failureText=data=>data.failure?' · '+explain(data.failure.code)+(brokerHints[data.failure.brokerHint]?' · נושא הודעת הברוקר: '+brokerHints[data.failure.brokerHint]+' (אינו אישור לתוצאת ההוראה)':'')+(data.failure.httpStatus?' · HTTP '+data.failure.httpStatus:'')+(data.requestId?' · מזהה בקשה: '+data.requestId:''):'';
Object.assign(messages,{REVIEW_STATE_CHANGED:'מצב ההוראה השתנה; רענן מצב לפני הסרת החסימה.',REVIEW_ACCOUNT_NOT_EMPTY:'לא ניתן להסיר את החסימה: קיימת הוראה או פוזיציה, או שהיסטוריית הברוקר אינה זמינה.'});
function say(text){
 $('colmexManualStatus').textContent=text;
 if($('colmexQuickTradeStatus'))$('colmexQuickTradeStatus').textContent=text;
 if($('colmexTradeDialog').open)$('colmexTradeResult').textContent=text;
}
Object.assign(messages,{WRITE_BROKER_ERROR:'הברוקר החזיר שגיאה ולא אישר ביצוע. הבקשה נשארת בבירור; אין לשלוח קנייה נוספת.',TRADE_RESULT_UNCERTAIN:'לא ניתן לאמת את תוצאת הבקשה. אין לשלוח שוב; יש לבדוק את מצב ההוראה.',INVALID_SYMBOL:'לא נבחרה מניה תקינה. בחר מניה בגרף ונסה שוב.'});
const errorText=error=>['TimeoutError','AbortError'].includes(error?.name)?'השרת לא השיב בזמן. תוצאת הפעולה אינה ידועה; אין לשלוח שוב.':error?.message||'לא ניתן להשלים את הבקשה כעת.';
function renderAccess(){
 $('colmexDeviceState').textContent=token?'המכשיר מחובר · ללא סיסמה בכל פעולה':'חיבור מכשיר חד־פעמי נדרש למסחר ידני';
 $('colmexPairForm').hidden=!!token;$('colmexDisconnect').hidden=!token;
 for(const id of ['colmexManualBuy','colmexManualSell','colmexDiagnosticBuy','colmexReleaseReview'])$(id).disabled=!token||busy||!!pending;
 $('colmexRetryTrade').disabled=true;
 $('colmexTradeSubmit').disabled=busy||!!pending||!token;
}
function rememberPending(value){pending=value;if(value)localStorage.setItem(PENDING_KEY,JSON.stringify(value));else localStorage.removeItem(PENDING_KEY);renderAccess();}
async function api(path,body){
 const response=await fetch('/.netlify/functions/'+path,{method:body?'POST':'GET',cache:'no-store',signal:AbortSignal.timeout(35000),headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 let data;try{data=await response.json();}catch{throw Error('השרת החזיר תגובה לא תקינה (HTTP '+response.status+'). לא ניתן לאמת את התוצאה; אין לשלוח שוב.');}
 if(response.status===401&&data.error==='DEVICE_REQUIRED'){token=null;try{localStorage.removeItem(TOKEN_KEY);}catch{}renderAccess();}
 return {response,data};
}
$('colmexPairForm').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;busy=true;renderAccess();
 try{
  const {response,data}=await api('colmex-device-access',{action:'pair',code:$('colmexPairCode').value.trim()});
  if(!response.ok)throw Error(explain(data.error));
  token=data.token;$('colmexPairCode').value='';
  try{localStorage.setItem(TOKEN_KEY,token);}catch{say('המכשיר מחובר לחלון הנוכחי בלבד; הדפדפן חסם שמירה.');return;}
  say('המכשיר חובר. אין צורך להקליד סיסמה בקניות ובמכירות.');
 }catch(error){say(error.message);}finally{busy=false;renderAccess();}
});
$('colmexDisconnect').addEventListener('click',async()=>{
 if(busy)return;try{const {response}=await api('colmex-device-access',{action:'disconnect'});if(!response.ok)throw Error();token=null;localStorage.removeItem(TOKEN_KEY);say('המכשיר נותק.');}catch{say('לא ניתן להשלים ניתוק כעת.');}renderAccess();
});
function selected(){return $('selectedSymbol').textContent.trim();}
function open(side,symbol=selected()){
 if(!token){say('יש לחבר את המכשיר למסחר לפני הפעולה.');if($('colmexManualDetails'))$('colmexManualDetails').open=true;return;}
 if(busy){say('בקשה מתבצעת כעת. המתן לתוצאה.');return;}
 if(pending){say('קיימת בקשה קודמת שטרם הושלם בירורה'+(pending.symbol?' · '+pending.symbol:'')+'. אין לשלוח שוב. מזהה בקשה: '+pending.requestId);if($('colmexManualDetails'))$('colmexManualDetails').open=true;checkPending();return;}
 diagnosticReviewId=null;reviewReleaseId=null;$('colmexTradeAmount').max='';$('colmexTradeSubmit').textContent='אני מאשר עסקה בכסף אמיתי';
 if(!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)){say(explain('INVALID_SYMBOL'));return;}
 $('colmexTradeSide').value=side;$('colmexTradeSymbol').value=symbol;
 $('colmexTradeTitle').textContent=(side==='BUY'?'קנייה ידנית · ':'מכירת כל הכמות · ')+symbol+' · LIVE';
 $('colmexAmountLabel').hidden=side!=='BUY';
 $('colmexTradeAmount').disabled=side!=='BUY';$('colmexTradeAmount').required=side==='BUY';
 $('colmexTradeDescription').textContent=side==='BUY'?'קנייה בחשבון האמיתי לפי הסכום שתבחר, בכפוף למזומן הפנוי ולעתודת עמלות. אינה מחייבת אות וואיקוף. הכמות תעוגל לפי מגבלות הברוקר; סטופ ויעד רווח לפי SETTINGS יצורפו לבקשה וידרשו אישור ברוקר.':'תישלח בקשת סגירה של כל פוזיציית ה־LONG במניה זו. קנייה אוטומטית חוזרת תדרוש אות כניסה חדש. הביצוע תלוי בברוקר ובשעות המסחר.';
 $('colmexTradeResult').textContent='';$('colmexTradeDialog').showModal();
}
$('colmexManualBuy').addEventListener('click',()=>open('BUY'));
$('colmexReleaseReview').addEventListener('click',async()=>{
 if(!token||busy||pending)return;
 busy=true;renderAccess();
 try{
  const {response,data}=await api('colmex-auto-status'),offer=data.reviewRecovery;
  if(!response.ok||!offer)throw Error('לא ניתן לאמת את אפשרות הסרת החסימה. רענן את האפליקציה.');
  if(!offer.available)throw Error(explain('REVIEW_STATE_CHANGED'));
  busy=false;open('BUY');reviewReleaseId=offer.reviewRequestId;
  $('colmexTradeTitle').textContent='הסרת חסימה · המשך ללא '+offer.blockedSymbol;
  const excluded=offer.excludedSymbols||[offer.blockedSymbol],total=offer.totalReservedUsd??offer.reservedUsd;
  $('colmexTradeDescription').textContent='האישור מסיר את חסימת הבירור הכללית ומאפשר קניות ידניות ואוטומטיות במניות אחרות בחשבון האמיתי, רק אם כל הבדיקות עוברות ויש די מזומן. מוחרגות מקניות: '+excluded.join(', ')+'. תיעוד ההוראות יישמר. $'+Number(offer.reservedUsd).toFixed(2)+' יישמרו עבור '+offer.blockedSymbol+'; סך כל הרזרבות לאחר האישור: $'+Number(total).toFixed(2)+', ב־'+(offer.reservedSlots||1)+' מתוך 3 מקומות. הסכום נשמר בחישוב הבוט, ואינו חיוב חדש. ייתכן שהיתרה לאחר הרזרבות לא תספיק לקנייה לפי התקציב הקיים, לפי המזומן הפנוי. הפעולה אינה מבטלת הוראה אצל הברוקר ואינה מאשרת שלא בוצעה.';
  $('colmexAmountLabel').hidden=true;$('colmexTradeAmount').disabled=true;
  $('colmexTradeSubmit').textContent='אני מאשר הסרת חסימה למסחר אוטומטי LIVE';
 }catch(error){say(error.message);}finally{busy=false;renderAccess();}
});
 $('colmexDiagnosticBuy').addEventListener('click',async()=>{
  if(!token||busy||pending)return;
  busy=true;renderAccess();
  try{
   const {response,data}=await api('colmex-auto-status'),offer=data.manualDiagnostic;
   if(!response.ok||!offer)throw Error('לא ניתן לאמת את מצב הבדיקה. רענן את האפליקציה.');
   if(!offer.available)throw Error(explain(offer.reason));
   if(selected()===offer.blockedSymbol)throw Error(explain('DIAGNOSTIC_SAME_INSTRUMENT'));
   busy=false;open('BUY');diagnosticReviewId=offer.reviewRequestId;
   $('colmexTradeAmount').max='';$('colmexTradeAmount').value='';$('colmexAmountLabel').hidden=true;$('colmexTradeAmount').required=false;
   $('colmexTradeTitle').textContent='בדיקת קנייה · מניה אחת · '+$('colmexTradeSymbol').value+' · LIVE';
   $('colmexTradeDescription').textContent='ניסיון ידני אחד לרכישת מניה אחת בלבד. ללא תקרה קבועה: המחיר ייבדק מול המזומן הפנוי לאחר רזרבות ועתודת עמלות. אם אין די מזומן לא תישלח הוראה. זו קנייה בכסף אמיתי. בניסיון זה רק userComment מקוצר ל־16 תווים; requestId נשאר מלא. סטופ ויעד רווח לפי SETTINGS יצורפו לבקשה וידרשו אישור ברוקר. בקשת '+offer.blockedSymbol+' נשארת בבירור והקניות האוטומטיות נשארות חסומות. התוצאה תוצג כאן לאחר השליחה.';
  }catch(error){say(error.message);}finally{busy=false;renderAccess();}
 });
$('colmexManualSell').addEventListener('click',()=>open('SELL'));
$('colmexTradeCancel').addEventListener('click',()=>$('colmexTradeDialog').close());
function finishUnexecuted(data){
 if(data.status==='REVIEW_RELEASED'){say('החסימה הגורפת הוסרה · '+(data.excludedSymbols||[data.symbol]).join(', ')+' מוחרגות מקניות · ההוראות נשארות בבירור אצל הברוקר. '+(Number.isFinite(data.availableCashAfterReservations)?'מזומן לאחר הרזרבות: $'+data.availableCashAfterReservations.toFixed(2)+'. ':'')+'קניות נוספות כפופות ליתרה, לאות חדש ולכל בדיקות המסחר.');rememberPending(null);return true;}
 if(!['REJECTED','NOT_SENT'].includes(data.status))return false;
 say((data.status==='NOT_SENT'?'ההוראה לא נשלחה לברוקר.':'הברוקר דחה את פרטי ההוראה; היא לא בוצעה.')+failureText(data));rememberPending(null);return true;
}
async function checkPending(){
 if(!pending||!token||busy)return;
 try{
  const {response,data}=await api('colmex-manual-trade?requestId='+encodeURIComponent(pending.requestId));
  if(!response.ok){say(explain(data.error));return;}
  if(finishUnexecuted(data))return;
  if(['FILLED','CLOSED','NO_FILL'].includes(data.status)){
   say(data.status==='FILLED'?'הברוקר אישר ביצוע קנייה · '+data.symbol:data.status==='CLOSED'?'הברוקר אישר סגירת הפוזיציה · '+data.symbol:'הוראת הקנייה הסתיימה ללא מילוי.');rememberPending(null);return;
  }
  $('colmexRetryTrade').disabled=data.status!=='NOT_RECORDED';
  say((data.reviewRequired?'הפעולה דורשת בדיקה אצל הברוקר. אין לשלוח שוב.':data.status==='NOT_RECORDED'?'לא נמצא עדיין רישום לבקשה. בדוק שוב לפני שליחה חוזרת.':data.acknowledged?'הברוקר אישר קבלת הוראה · ממתין לאימות ביצוע.':'הבקשה מתועדת; תוצאת השליחה עדיין לא אומתה. אין לשלוח שוב.')+failureText(data));
 }catch{say('לא ניתן לאמת את תוצאת הפעולה. אין לשלוח שוב; בדוק אצל הברוקר.');}
}
$('colmexCheckTrade').addEventListener('click',checkPending);
async function send(input,retry=false){
 busy=true;renderAccess();$('colmexTradeSubmit').disabled=true;
 say('הבקשה נשלחת לבדיקה · '+(input.symbol||'בירור הוראה')+' · נא להמתין.');
 try{
  const {response,data}=await api('colmex-manual-trade',input);
  if(!response.ok){
   if(response.status<500&&!retry)rememberPending(null);
   throw Error(explain(data.error));
  }
  if(!finishUnexecuted(data))say((data.acknowledged?'הברוקר אישר קבלת הוראה · ממתין לאימות ביצוע.':'תוצאת שליחת ההוראה אינה ודאית. אין לשלוח שוב.')+failureText(data));
 }catch(error){say(errorText(error));}
 finally{busy=false;renderAccess();}
}
$('colmexRetryTrade').addEventListener('click',async()=>{if(pending&&!busy)await send(pending,true);});
$('colmexTradeForm').addEventListener('submit',async event=>{
 event.preventDefault();if(busy||pending)return;
 const input={requestId:crypto.randomUUID(),symbol:$('colmexTradeSymbol').value,side:$('colmexTradeSide').value};
 if(reviewReleaseId){delete input.symbol;delete input.side;input.action='release_review';input.reviewRequestId=reviewReleaseId;}
 else if(input.side==='BUY')input.amountUsd=Number($('colmexTradeAmount').value);
 if(diagnosticReviewId){input.diagnostic=true;input.singleShare=true;input.reviewRequestId=diagnosticReviewId;delete input.amountUsd;}
 // Persist the request identity before network I/O. Never auto-resubmit a financial action.
 try{rememberPending(input);}catch{pending=null;renderAccess();$('colmexTradeResult').textContent='לא ניתן לשמור מזהה בקשה במכשיר. לא נשלחה הוראה.';return;}
 await send(input);
});
renderAccess();if(pending)checkPending();setInterval(()=>{if(!document.hidden)checkPending();},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkPending();});

globalThis.addEventListener?.('trade-device-connected',()=>{try{token=localStorage.getItem(TOKEN_KEY);}catch{}renderAccess();});

globalThis.addEventListener?.('trade-device-expired',()=>{token=null;renderAccess();});

globalThis.LEVI_QUICK_TRADE=(side,symbol,market)=>{if(market==='STOCK')open(side,symbol);};
for(const [id,side] of [['colmexQuickBuy','BUY'],['colmexQuickSell','SELL']])$(id)?.addEventListener('click',()=>open(side));
