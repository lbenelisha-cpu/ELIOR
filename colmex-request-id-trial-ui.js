const button=document.getElementById('colmexShortIdTrial'),dialog=document.getElementById('colmexShortIdDialog'),form=document.getElementById('colmexShortIdForm'),result=document.getElementById('colmexShortIdResult'),submit=document.getElementById('colmexShortIdConfirm');
const key='levi-colmex-aapl-short-request-id-v1',reviewRequestId='e9ff564c-8c59-4e22-9ce0-77561044536b';
let busy=false;
button.addEventListener('click',()=>{if(localStorage.getItem(key)){submit.disabled=true;result.textContent='כבר נשמר ניסיון במכשיר הזה. אין לשלוח שוב; יש לבדוק את מצבו בשרת.';}dialog.showModal();});
document.getElementById('colmexShortIdCancel').addEventListener('click',()=>dialog.close());
form.addEventListener('submit',async event=>{
 event.preventDefault();if(busy||localStorage.getItem(key))return;
 const token=localStorage.getItem('levi-colmex-device-v1');if(!token){result.textContent='נדרש מכשיר מחובר.';return;}
 busy=true;submit.disabled=true;
 try{
 const requestId=crypto.randomUUID();localStorage.setItem(key,requestId);
 const response=await fetch('/.netlify/functions/colmex-manual-trade',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({side:'BUY',symbol:'AAPL',diagnostic:true,singleShare:true,shortRequestId:true,reviewRequestId,requestId}),signal:AbortSignal.timeout(35000)});
 const data=await response.json();
 result.textContent='מזהה הבדיקה: '+requestId+' · '+(response.ok?'מצב: '+data.status+(data.acknowledged?' · התקבל אישור קליטת הוראה; עדיין נדרש אימות ביצוע והגנות.':' · אין אישור ביצוע. אין לשלוח שוב.'):'לא אושר ביצוע: '+(data.error||'תוצאה לא ידועה')+'. אין לשלוח שוב לפני בדיקה.');
 }catch{result.textContent='אין תוצאה ודאית. אין לשלוח שוב. יש לבדוק את המזהה השמור מול מצב השרת.';}
 finally{busy=false;}
});
