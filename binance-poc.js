(()=>{
 const el=id=>document.getElementById(id);if(!el('pocPanel'))return;
 const labels={WAITING:'ממתינה למחיר',EXECUTING:'נבדקת ונשלחת — אין ליצור שוב',UNKNOWN:'ממתינה לאימות ביצוע',FILLED:'בוצעה — בניהול הבוט',NO_FILL:'הסתיימה ללא מילוי',FAILED:'לא בוצעה',CANCELLED:'בוטלה',EXPIRED:'פג התוקף',MISSED:'המחיר דילג מעבר ליעד'};
 const reasons={POC_EXECUTION_BUSY:'ממתינה לסיום הפעולה הקודמת; טרם נשלחה כניסה.',POC_ALREADY_REACHED:'המחיר כבר עבר את היעד בכיוון שבחרת. בחר יעד או כיוון מתאים.',POC_ALREADY_PENDING:'כבר קיימת המתנה לאותו נכס וכיוון.',POC_TRADING_PAUSED:'הכניסות מושהות או שהחשבון אינו במצב LIVE.',POC_PRICE_GAP:'המחיר עבר את היעד ביותר מ־0.15%; לא נשלחה כניסה.',POC_PRICE_MOVED:'המחיר השתנה בבדיקה האחרונה; לא נשלחה כניסה.',POC_WAIT_FRESH_PRICE:'ממתינים למחיר עדכני.',POC_SETTINGS_CHANGED:'ההגדרות השתנו במהלך הביצוע; צור הוראה חדשה לאחר הבדיקה.',POC_OUTCOME_UNKNOWN:'טרם התקבל אישור סופי. מתבצעת בדיקה של אותה הוראה בלבד.',POC_ALREADY_DISPATCHED:'הביצוע כבר החל. לא ניתן לבטל את ההמתנה בשלב זה.',POC_SHORT_TP_BELOW_100_REQUIRED:'ל־SHORT נדרש יעד רווח קטן מ־100% בהגדרות.',POC_SELECT_SCANNED_SYMBOL:'בחר נכס מתוך רשימת הנכסים בסריקה.',FUTURES_SHORT_DISABLED:'מסלול SHORT אינו מופעל בשרת.',POC_NO_FILL:'לא בוצעה כמות; ההוראה לא תישלח שוב.',FUTURES_BUSY_NO_ORDER:'מנגנון SHORT היה עסוק; לא נשלחה פקודה.',POC_STOP_ALL:'בוטלה בעקבות עצירת המסחר.'};
 const msg=value=>reasons[value]||String(value||'');
 const number=value=>Number.isFinite(Number(value))?Number(value).toLocaleString('he-IL',{maximumFractionDigits:8}):'—';
 const date=value=>new Date(value).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'});
 let data=null,reading=false,sending=false,request=null,unknownCreate=false;
 const context=()=>window.LEVI_MANUAL_TRADES?.context()||{};
 function status(text,error=false){el('pocMessage').textContent=text;el('pocMessage').classList.toggle('poc-warning',error);}
 function ready(){for(const field of el('pocForm').querySelectorAll('input,select'))field.disabled=sending||unknownCreate;el('pocCreate').disabled=sending||unknownCreate||!data?.ok||!data.control?.allowEntries||context().mode!=='live';}
 function syncFields(){
  if(!request&&!el('pocPrice').value&&!el('pocAmount').value)el('pocSymbol').value=context().symbol||'';
  el('pocAmount').max=el('pocSide').value==='SHORT'?(data?.maxShortUsdt||0):data?.maxLongUsdt||400;
  const s=data?.settings;
  el('pocPolicy').textContent=s?`לאחר הכניסה: סטופ ${s.stopLossPct}% · יעד רווח ${s.takeProfitPct}% · הפעלת הגנת רווח ${s.profitActivationPct}% · מרחק נגרר ${s.trailingGapPp} נקודות אחוז. ההגדרות הפעילות בזמן הכניסה קובעות; שינויים בהמשך חלים לפי מנגנון ניהול הפוזיציה.`:'טוען הגדרות ניהול…';
  ready();
 }
 function render(){
  const body=el('pocRows');body.replaceChildren();
  for(const r of (data.rows||[]).slice(0,100)){
   const tr=document.createElement('tr');
   const cell=text=>{const td=document.createElement('td');td.textContent=text;tr.append(td);return td;};
   const asset=cell(r.symbol);const market=document.createElement('small');market.textContent=r.side==='LONG'?'LONG · Spot':'SHORT · Futures Isolated 1x';asset.append(market);
   cell(number(r.poc)+(r.direction==='ABOVE'?' ↑ בעלייה':' ↓ בירידה'));cell(number(r.quoteUsdt)+' USDT');
   const st=cell(labels[r.status]||r.status);st.className='poc-status-'+r.status;
   if(r.reason){const note=document.createElement('small');note.textContent=msg(r.reason);st.append(note);}
   if(r.order){const note=document.createElement('small');note.textContent=`הזמנה ${r.order.orderId} · כמות ${number(r.order.executedQty)}`;st.append(note);}
   cell(date(r.expiresAt));
   const action=cell('');if(r.status==='WAITING'){const b=document.createElement('button');b.type='button';b.textContent='בטל המתנה';b.onclick=()=>cancel(r.requestId,b);action.append(b);}
   body.append(tr);
  }
  if(!data.rows?.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=6;td.textContent='אין הוראות POC שמורות.';tr.append(td);body.append(tr);}
 }
 async function load(){
  if(reading||!window.LEVI_POC)return;reading=true;
  try{
   const result=await window.LEVI_POC.read();if(result.version!==1||!result.ok)throw Error(result.error||'נדרש עדכון שרת');data=result;render();
   if(unknownCreate&&request){
    const found=data.rows.find(r=>r.requestId===request.requestId);
    if(found){status('ההוראה נשמרה בשרת: '+(labels[found.status]||found.status));unknownCreate=false;request=null;el('pocConfirm').checked=false;}
    else status('ההוראה לא נמצאה עדיין. ניתן לנסות לשמור שוב את אותה בקשה בבטחה.',true);
   }
   el('pocChecked').textContent=data.checkedAt?'בדיקת שרת: '+date(data.checkedAt):'ממתין למחזור בדיקה ראשון';
  }catch(error){
   data=null;el('pocRows').replaceChildren();
   status(error.status===404?'המסך מוכן; יש להתקין את עדכון POC בשרת לפני יצירת הוראות.':error.status===401?'חבר את המכשיר למסחר כדי לצפות בהוראות POC.':'לא ניתן לקרוא את הוראות POC כרגע: '+msg(error.message),true);
  }finally{reading=false;syncFields();el('pocRetry').hidden=!unknownCreate;}
 }
 async function create(retry=false){
  if(sending)return;
  if(!window.LEVI_MANUAL_TRADES?.connected()){window.LEVI_MANUAL_TRADES?.connect();return;}
  if(!retry){
   if(!el('pocForm').reportValidity()||!el('pocConfirm').checked)return;
   request={action:'create',requestId:'poc-'+crypto.randomUUID(),mode:'live',confirmed:true,symbol:el('pocSymbol').value,side:el('pocSide').value,direction:el('pocDirection').value,poc:Number(el('pocPrice').value),quoteUsdt:Number(el('pocAmount').value),expiresHours:Number(el('pocExpiry').value)};
  }
  if(!request)return;sending=true;ready();el('pocRetry').disabled=true;status('שומר הוראת POC בשרת…');
  try{
   const result=await window.LEVI_POC.write(request);
   if(!result)return;
   if(!result.ok)throw Error(result.error||'השמירה לא אושרה');
   status('ההוראה נשמרה. הבוט ימתין למחיר גם כשהאפליקציה סגורה, כל עוד השרת פועל.');request=null;unknownCreate=false;el('pocConfirm').checked=false;
  }catch(error){
   unknownCreate=!(error.status>=400&&error.status<500);
   status(unknownCreate?'לא התקבל אישור שמירה. בודקים את אותה בקשה; אין ליצור הוראה נוספת.':msg(error.message),true);
   if(!unknownCreate)request=null;
  }finally{sending=false;el('pocRetry').disabled=false;await load();}
 }
 async function cancel(id,button){
  button.disabled=true;
  try{const r=await window.LEVI_POC.write({action:'cancel',requestId:id});if(r?.ok)status('ההמתנה בוטלה.');}
  catch(error){status('לא התקבל אישור ביטול: '+msg(error.message),true);}
  finally{await load();}
 }
 el('pocForm').onsubmit=e=>{e.preventDefault();void create();};el('pocRefresh').onclick=()=>load();el('pocRetry').onclick=()=>create(true);el('pocSide').onchange=()=>{el('pocConfirm').checked=false;syncFields();};
 el('pocUseSelected').onclick=()=>{if(sending||unknownCreate)return;el('pocSymbol').value=context().symbol||'';el('pocPrice').value='';el('pocAmount').value='';el('pocConfirm').checked=false;};
 el('pocPanel').addEventListener('toggle',()=>{if(el('pocPanel').open)void load();});
 window.addEventListener('trade-device-expired',()=>{data=null;el('pocRows').replaceChildren();ready();});
 setInterval(()=>{if(el('pocPanel').open&&!document.hidden)void load();},10000);syncFields();
})();
