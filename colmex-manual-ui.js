import {entryReasonLabel} from './lib/colmex-entry-reasons.mjs?v=20261027-review-recovery';
const $=id=>document.getElementById(id),TOKEN_KEY='levi-colmex-device-v1',PENDING_KEY='levi-colmex-manual-pending-v1';
let token=null,pending=null,busy=false,diagnosticReviewId=null,reviewReleaseId=null;
try{token=localStorage.getItem(TOKEN_KEY);pending=JSON.parse(localStorage.getItem(PENDING_KEY)||'null');}catch{}
const messages={DEVICE_REQUIRED:'יש לחבר את המכשיר פעם אחת בקוד קצר.',PAIRING_NOT_CONFIGURED:'יש להגדיר ב־Netlify קוד חיבור קבוע COLMEX_DEVICE_PAIR_CODE בן 6 ספרות ולפרסם מחדש.',PAIR_CODE_INVALID:'קוד החיבור אינו נכון.',PAIR_CODE_EXPIRED_OR_USED:'קוד החיבור אינו פעיל. בדוק את הגדרת השרת.',PAIR_CODE_COOLDOWN:'יותר מדי ניסיונות. אפשר להשתמש באותו קוד שוב בעוד 15 דקות.',PAIR_CODE_RETRY:'בקשת חיבור נוספת מתבצעת. נסה שוב.',TRADE_IN_PROGRESS:'פעולת מסחר אחרת מתבצעת. המתן לסיומה.',LIVE_NOT_ENABLED:'מסחר LIVE אינו מופעל בשרת.',INVALID_BUY_AMOUNT:'יש להזין סכום גדול מאפס ועד 800 דולר.',NO_FREE_SLOT:'כל שלוש הפוזיציות תפוסות.',NO_UNIQUE_LONG_POSITION:'לא נמצאה פוזיציית LONG יחידה במניה זו.',MINIMUM_QUANTITY_ABOVE_BUDGET:'הכמות המינימלית יקרה מהסכום שבחרת.',INSUFFICIENT_UNLEVERAGED_CASH:'אין די מזומן לקנייה ולרזרבה של 5 דולר.',OUTSIDE_REGULAR_SESSION:'קנייה זמינה בשעות המסחר הרגילות בארה״ב.',EXISTING_POSITION_OR_ORDER:'קיימת פוזיציה או הוראה במניה שמונעת את הפעולה.',INSTRUMENT_UNAVAILABLE:'המניה אינה זמינה באופן חד־משמעי אצל הברוקר.',REQUIRES_REVIEW:'פעולה קודמת דורשת בדיקה אצל הברוקר.',BROKER_BRACKET_PERMISSION_REQUIRED:'נדרשות הרשאות מסחר וסטופ אצל הברוקר.'};
Object.assign(messages,{INVALID_DIAGNOSTIC_REQUEST:'בדיקת קנייה מותרת עד 200 דולר בלבד.',DIAGNOSTIC_STATE_CHANGED:'מצב ההוראה שבבירור השתנה או אינו מאפשר בדיקה נפרדת. לא נשלחה קנייה.',DIAGNOSTIC_ALREADY_USED:'כבר תועד ניסיון בדיקה עבור ההוראה שבבירור. אין לשלוח ניסיון נוסף.',DIAGNOSTIC_SAME_INSTRUMENT:'יש לבחור מניה אחרת מזו שההוראה שלה בבירור.',DIAGNOSTIC_ACCOUNT_NOT_EMPTY:'בדיקה נפרדת דורשת חשבון ללא פוזיציות או הוראות פתוחות והיסטוריה זמינה.'});
const explain=code=>messages[code]||entryReasonLabel(code);
const failureText=data=>data.failure?' · '+explain(data.failure.code)+(data.failure.httpStatus?' · HTTP '+data.failure.httpStatus:'')+(data.requestId?' · מזהה בקשה: '+data.requestId:''):'';
Object.assign(messages,{REVIEW_STATE_CHANGED:'מצב ההוראה השתנה; רענן מצב לפני הסרת החסימה.',REVIEW_ACCOUNT_NOT_EMPTY:'לא ניתן להסיר את החסימה: קיימת הוראה או פוזיציה, או שהיסטוריית הברוקר אינה זמינה.'});
function say(text){$('colmexManualStatus').textContent=text;}
function renderAccess(){
 $('colmexDeviceState').textContent=token?'המכשיר מחובר · ללא סיסמה בכל פעולה':'חיבור מכשיר חד־פעמי נדרש למסחר ידני';
 $('colmexPairForm').hidden=!!token;$('colmexDisconnect').hidden=!token;
 for(const id of ['colmexManualBuy','colmexManualSell','colmexDiagnosticBuy','colmexReleaseReview'])$(id).disabled=!token||busy||!!pending;
 $('colmexRetryTrade').disabled=true;
}
function rememberPending(value){pending=value;if(value)localStorage.setItem(PENDING_KEY,JSON.stringify(value));else localStorage.removeItem(PENDING_KEY);renderAccess();}
async function api(path,body){
 const response=await fetch('/.netlify/functions/'+path,{method:body?'POST':'GET',cache:'no-store',signal:AbortSignal.timeout(35000),headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json();
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
function open(side){
 if(!token||busy||pending)return;
 diagnosticReviewId=null;reviewReleaseId=null;$('colmexTradeAmount').max='800';$('colmexTradeSubmit').textContent='אני מאשר עסקה בכסף אמיתי';
 const symbol=selected();$('colmexTradeSide').value=side;$('colmexTradeSymbol').value=symbol;
 $('colmexTradeTitle').textContent=(side==='BUY'?'קנייה ידנית · ':'מכירת כל הכמות · ')+symbol+' · LIVE';
 $('colmexAmountLabel').hidden=side!=='BUY';
 $('colmexTradeAmount').disabled=side!=='BUY';
 $('colmexTradeDescription').textContent=side==='BUY'?'קנייה בחשבון האמיתי לפי הסכום שתבחר, עד 800 דולר לפני עמלות. אינה מחייבת אות וואיקוף. הכמות תעוגל לפי מגבלות הברוקר; סטופ ויעד רווח לפי SETTINGS יצורפו לבקשה וידרשו אישור ברוקר.':'תישלח בקשת סגירה של כל פוזיציית ה־LONG במניה זו. קנייה אוטומטית חוזרת תדרוש אות כניסה חדש. הביצוע תלוי בברוקר ובשעות המסחר.';
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
  $('colmexTradeDescription').textContent='האישור מאפשר שוב קניות ידניות ואוטומטיות במניות אחרות בחשבון האמיתי, לפי החוקים והיתרה הזמינה. '+offer.blockedSymbol+' תישאר מוחרגת מקניות, ותיעוד ההוראה יישמר. $'+Number(offer.reservedUsd).toFixed(2)+' יישארו שמורים כנגד ההוראה שלא אומתה. הפעולה אינה מבטלת הוראה אצל הברוקר ואינה מאשרת שלא בוצעה. אין צורך לפנות לתמיכה כדי לבצע פעולה זו.';
  $('colmexAmountLabel').hidden=true;$('colmexTradeAmount').disabled=true;
  $('colmexTradeSubmit').textContent='אשר הסרת חסימה וחידוש המעקב';
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
   $('colmexTradeAmount').max='200';$('colmexTradeAmount').value='200';
   $('colmexTradeTitle').textContent='בדיקת קנייה אמיתית · '+$('colmexTradeSymbol').value+' · LIVE';
   $('colmexTradeDescription').textContent='ניסיון ידני אחד, עד 200 דולר לפני עמלות, במניה שבחרת. זו קנייה בכסף אמיתי. סטופ ויעד רווח לפי SETTINGS יצורפו לבקשה וידרשו אישור ברוקר. בקשת '+offer.blockedSymbol+' נשארת בבירור והקניות האוטומטיות נשארות חסומות. התוצאה תוצג כאן לאחר השליחה.';
  }catch(error){say(error.message);}finally{busy=false;renderAccess();}
 });
$('colmexManualSell').addEventListener('click',()=>open('SELL'));
$('colmexTradeCancel').addEventListener('click',()=>$('colmexTradeDialog').close());
function finishUnexecuted(data){
 if(data.status==='REVIEW_RELEASED'){say('החסימה הגורפת הוסרה · '+data.symbol+' מוחרגת מקניות · המעקב במניות אחרות יכול להמשיך לפי החוקים והיתרה.');rememberPending(null);return true;}
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
 try{
  const {response,data}=await api('colmex-manual-trade',input);
  if(!response.ok){
   if(response.status<500&&!retry)rememberPending(null);
   throw Error(explain(data.error));
  }
  if(!finishUnexecuted(data))say((data.acknowledged?'הברוקר אישר קבלת הוראה · ממתין לאימות ביצוע.':'תוצאת שליחת ההוראה אינה ודאית. אין לשלוח שוב.')+failureText(data));$('colmexTradeDialog').close();
 }catch(error){$('colmexTradeResult').textContent=error.message;say(error.message+' · אם התוצאה אינה ודאית, אין לשלוח שוב.');}
 finally{busy=false;renderAccess();$('colmexTradeSubmit').disabled=false;}
}
$('colmexRetryTrade').addEventListener('click',async()=>{if(pending&&!busy)await send(pending,true);});
$('colmexTradeForm').addEventListener('submit',async event=>{
 event.preventDefault();if(busy||pending)return;
 const input={requestId:crypto.randomUUID(),symbol:$('colmexTradeSymbol').value,side:$('colmexTradeSide').value};
 if(reviewReleaseId){delete input.symbol;delete input.side;input.action='release_review';input.reviewRequestId=reviewReleaseId;}
 else if(input.side==='BUY')input.amountUsd=Number($('colmexTradeAmount').value);
 if(diagnosticReviewId){input.diagnostic=true;input.reviewRequestId=diagnosticReviewId;if(!(input.amountUsd>0&&input.amountUsd<=200)){$('colmexTradeResult').textContent=explain('INVALID_DIAGNOSTIC_REQUEST');return;}}
 // Persist the request identity before network I/O. Never auto-resubmit a financial action.
 try{rememberPending(input);}catch{pending=null;renderAccess();$('colmexTradeResult').textContent='לא ניתן לשמור מזהה בקשה במכשיר. לא נשלחה הוראה.';return;}
 await send(input);
});
renderAccess();if(pending)checkPending();setInterval(()=>{if(!document.hidden)checkPending();},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkPending();});

globalThis.addEventListener?.('trade-device-connected',()=>{try{token=localStorage.getItem(TOKEN_KEY);}catch{}renderAccess();});

globalThis.addEventListener?.('trade-device-expired',()=>{token=null;renderAccess();});
