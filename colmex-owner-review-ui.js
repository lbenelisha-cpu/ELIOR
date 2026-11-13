const button=document.getElementById('colmexResolveMeta'),dialog=document.getElementById('colmexMetaDialog'),form=document.getElementById('colmexMetaForm'),status=document.getElementById('colmexMetaResult'),confirm=document.getElementById('colmexMetaConfirm');
const reviewRequestId='aed2b9b1-1b98-45b8-9dd8-bd5ca0c640c9',key='levi-colmex-owner-meta-resolution-v1';let busy=false,requestId;
button.addEventListener('click',()=>{status.textContent='';dialog.showModal();});
document.getElementById('colmexMetaCancel').addEventListener('click',()=>dialog.close());
form.addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;
 const token=localStorage.getItem('levi-colmex-device-v1');if(!token){status.textContent='יש לחבר את המכשיר באזור קנייה ומכירה ידנית.';return;}
 busy=true;confirm.disabled=true;
 try{
 requestId=localStorage.getItem(key)||crypto.randomUUID();localStorage.setItem(key,requestId);
 const response=await fetch('/.netlify/functions/colmex-manual-trade',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'resolve_meta_unreceived',reviewRequestId,requestId,confirmation:'OWNER_CONFIRMS_BROKER_DID_NOT_RECEIVE_META'}),signal:AbortSignal.timeout(35000)});
 const data=await response.json();if(!response.ok)throw Error(data.error||'REVIEW_FAILED');
 if(data.status!=='OWNER_REVIEW_RESOLVED')throw Error('UNKNOWN_RESULT');
 status.textContent='האישור נשמר. בקשת META סומנה כלא התקבלה לפי אישורך; הבקשה הישנה לא נשלחה שוב. חסימת הבירור הוסרה, והכניסות כפופות לאותות חדשים ולבדיקות השרת.';
 const pending=JSON.parse(localStorage.getItem('levi-colmex-manual-pending-v1')||'null');if(pending?.requestId===reviewRequestId)localStorage.removeItem('levi-colmex-manual-pending-v1');
 button.disabled=true;
 }catch(error){status.textContent='לא אושרה השלמת הסרת החסימה. יש לבדוק את מצב השרת לפני ניסיון נוסף. '+error.message;}
 finally{busy=false;}
});
