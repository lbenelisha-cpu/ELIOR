(()=>{
 const get=id=>document.getElementById(id),dialog=get('deviceConnectionDialog');if(!dialog)return;
 let busy=false,persistent=true;
 function refresh(){const c=window.LEVI_MANUAL_TRADES,connected=c?.connected?.()===true;get('manualConnectBtn').hidden=connected;get('deviceAccessStatus').textContent=connected?(persistent?'המכשיר מחובר למסחר · קנייה ומכירה ללא הזנת קוד':'חיבור זמני בלבד · הדפדפן חוסם שמירת נתונים'):'המכשיר אינו מחובר למסחר';}
 function open(){if(busy)return;get('devicePairCode').value='';get('devicePairResult').textContent='הזן את קוד החיבור הקבוע. אפשר להשתמש באותו קוד במכשירים נוספים. החיבור אינו מבצע עסקה.';if(!dialog.open)dialog.showModal();get('devicePairCode').focus();}
 async function connect(){
  if(busy)return;const code=get('devicePairCode').value.trim();
  if(!/^\d{6}$/.test(code)){get('devicePairResult').textContent='יש להזין שש ספרות';return;}
  busy=true;get('devicePairSubmit').disabled=true;get('devicePairCancel').disabled=true;
  try{
   const result=await window.LEVI_MANUAL_TRADES.pair(code);persistent=result?.persistent!==false;
   get('devicePairCode').value='';dialog.close();refresh();
   Promise.resolve(window.LEVI_MANUAL_TRADES.refresh?.()).catch(()=>{});
   get('manualTradeHint').textContent=persistent?'המכשיר חובר. אפשר ללחוץ על קנייה או מכירה ללא קוד. לא בוצעה עסקה.':'הדפדפן חוסם שמירה. החיבור פעיל עד סגירת הדף בלבד. לא בוצעה עסקה.';
  }catch(error){get('devicePairResult').textContent=error.status===404?'יש להתקין בשרת את עדכון חיבור המכשירים.':error.message;}
  finally{busy=false;get('devicePairSubmit').disabled=false;get('devicePairCancel').disabled=false;}
 }
 get('manualConnectBtn').onclick=open;get('devicePairSubmit').onclick=connect;
 get('devicePairCancel').onclick=()=>{if(!busy)dialog.close();};
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 window.LEVI_DEVICE_ACCESS={open,refresh};setInterval(refresh,1000);refresh();
})();
