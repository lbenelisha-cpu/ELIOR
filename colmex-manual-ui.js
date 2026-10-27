const $=id=>document.getElementById(id),TOKEN_KEY='levi-colmex-device-v1',PENDING_KEY='levi-colmex-manual-pending-v1';
let token=null,pending=null,busy=false;
try{token=localStorage.getItem(TOKEN_KEY);pending=JSON.parse(localStorage.getItem(PENDING_KEY)||'null');}catch{}
const messages={DEVICE_REQUIRED:'יש לחבר את המכשיר פעם אחת בקוד קצר.',PAIRING_NOT_CONFIGURED:'יש להגדיר ב־Netlify קוד חיבור קבוע COLMEX_DEVICE_PAIR_CODE בן 6 ספרות ולפרסם מחדש.',PAIR_CODE_INVALID:'קוד החיבור אינו נכון.',PAIR_CODE_EXPIRED_OR_USED:'קוד החיבור אינו פעיל. בדוק את הגדרת השרת.',PAIR_CODE_COOLDOWN:'יותר מדי ניסיונות. אפשר להשתמש באותו קוד שוב בעוד 15 דקות.',PAIR_CODE_RETRY:'בקשת חיבור נוספת מתבצעת. נסה שוב.',TRADE_IN_PROGRESS:'פעולת מסחר אחרת מתבצעת. המתן לסיומה.',LIVE_NOT_ENABLED:'מסחר LIVE אינו מופעל בשרת.',INVALID_BUY_AMOUNT:'יש להזין סכום גדול מאפס ועד 800 דולר.',NO_FREE_SLOT:'כל שלוש הפוזיציות תפוסות.',NO_UNIQUE_LONG_POSITION:'לא נמצאה פוזיציית LONG יחידה במניה זו.',MINIMUM_QUANTITY_ABOVE_BUDGET:'הכמות המינימלית יקרה מהסכום שבחרת.',INSUFFICIENT_UNLEVERAGED_CASH:'אין די מזומן לקנייה ולרזרבה של 5 דולר.',OUTSIDE_REGULAR_SESSION:'קנייה זמינה בשעות המסחר הרגילות בארה״ב.',EXISTING_POSITION_OR_ORDER:'קיימת פוזיציה או הוראה במניה שמונעת את הפעולה.',INSTRUMENT_UNAVAILABLE:'המניה אינה זמינה באופן חד־משמעי אצל הברוקר.',REQUIRES_REVIEW:'פעולה קודמת דורשת בדיקה אצל הברוקר.',BROKER_BRACKET_PERMISSION_REQUIRED:'נדרשות הרשאות מסחר וסטופ אצל הברוקר.'};
const explain=code=>messages[code]||'הפעולה לא אושרה: '+code;
function say(text){$('colmexManualStatus').textContent=text;}
function renderAccess(){
 $('colmexDeviceState').textContent=token?'המכשיר מחובר · ללא סיסמה בכל פעולה':'חיבור מכשיר חד־פעמי נדרש למסחר ידני';
 $('colmexPairForm').hidden=!!token;$('colmexDisconnect').hidden=!token;
 for(const id of ['colmexManualBuy','colmexManualSell'])$(id).disabled=!token||busy||!!pending;
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
 const symbol=selected();$('colmexTradeSide').value=side;$('colmexTradeSymbol').value=symbol;
 $('colmexTradeTitle').textContent=(side==='BUY'?'קנייה ידנית · ':'מכירת כל הכמות · ')+symbol+' · LIVE';
 $('colmexAmountLabel').hidden=side!=='BUY';
 $('colmexTradeAmount').disabled=side!=='BUY';
 $('colmexTradeDescription').textContent=side==='BUY'?'קנייה בחשבון האמיתי לפי הסכום שתבחר, עד 800 דולר. אינה מחייבת אות וואיקוף. הכמות תעוגל לפי מגבלות הברוקר; סטופ ראשוני של 10% יצורף.':'תישלח בקשת סגירה של כל פוזיציית ה־LONG במניה זו, גם לפני תום תקופת ההחזקה. קנייה אוטומטית חוזרת תדרוש אות וואיקוף חדש. הביצוע תלוי בברוקר ובשעות המסחר.';
 $('colmexTradeResult').textContent='';$('colmexTradeDialog').showModal();
}
$('colmexManualBuy').addEventListener('click',()=>open('BUY'));
$('colmexManualSell').addEventListener('click',()=>open('SELL'));
$('colmexTradeCancel').addEventListener('click',()=>$('colmexTradeDialog').close());
function finishUnexecuted(data){
 if(!['REJECTED','NOT_SENT'].includes(data.status))return false;
 say(data.status==='NOT_SENT'?'ההוראה לא נשלחה לברוקר.':'הברוקר דחה את פרטי ההוראה; היא לא בוצעה.');rememberPending(null);return true;
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
  say(data.reviewRequired?'הפעולה דורשת בדיקה אצל הברוקר. אין לשלוח שוב.':data.status==='NOT_RECORDED'?'לא נמצא עדיין רישום לבקשה. בדוק שוב לפני שליחה חוזרת.':'הבקשה מתועדת וממתינה לאימות ביצוע אצל הברוקר.');
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
  if(!finishUnexecuted(data))say('בקשת המסחר נשלחה · ממתין לאימות ביצוע אצל הברוקר.');$('colmexTradeDialog').close();
 }catch(error){$('colmexTradeResult').textContent=error.message;say(error.message+' · אם התוצאה אינה ודאית, אין לשלוח שוב.');}
 finally{busy=false;renderAccess();$('colmexTradeSubmit').disabled=false;}
}
$('colmexRetryTrade').addEventListener('click',async()=>{if(pending&&!busy)await send(pending,true);});
$('colmexTradeForm').addEventListener('submit',async event=>{
 event.preventDefault();if(busy||pending)return;
 const input={requestId:crypto.randomUUID(),symbol:$('colmexTradeSymbol').value,side:$('colmexTradeSide').value};
 if(input.side==='BUY')input.amountUsd=Number($('colmexTradeAmount').value);
 // Persist the request identity before network I/O. Never auto-resubmit a financial action.
 try{rememberPending(input);}catch{pending=null;renderAccess();$('colmexTradeResult').textContent='לא ניתן לשמור מזהה בקשה במכשיר. לא נשלחה הוראה.';return;}
 await send(input);
});
renderAccess();if(pending)checkPending();setInterval(()=>{if(!document.hidden)checkPending();},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkPending();});

globalThis.addEventListener?.('trade-device-connected',()=>{try{token=localStorage.getItem(TOKEN_KEY);}catch{}renderAccess();});

globalThis.addEventListener?.('trade-device-expired',()=>{token=null;renderAccess();});
