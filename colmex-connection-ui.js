const $=id=>document.getElementById(id),connect=$('colmexBrokerConnect'),disconnect=$('colmexBrokerDisconnect'),status=$('colmexBrokerConnectionStatus');
let busy=false,state=null;
const messages={DEVICE_REQUIRED:'יש לחבר את המכשיר בקוד באזור קנייה ומכירה ידנית כדי לשנות את חיבור הברוקר.',CONNECTION_STATE_CHANGED:'מצב החיבור השתנה ממכשיר אחר. רענן ונסה שוב.',CONNECTION_STATE_UNAVAILABLE:'לא ניתן לאמת את מצב החיבור. אין להסיק שהניתוק הושלם.'};
function render(){connect.disabled=busy||state===null||state.enabled;disconnect.disabled=busy||state===null||!state.enabled;}
function show(){
 if(!state)return;
 if(state.enabled)status.textContent='חיבור האפליקציה פעיל · הבוט רשאי לגשת לקולמקס. מצב זה אינו אישור לביצוע עסקה.';
 else{const left=Math.max(0,Math.ceil((state.settledAt-Date.now())/1000));status.textContent=left?'החיבור הושהה · ממתין לסיום בקשות שכבר יצאו: '+left+' שניות. אין התחברויות חדשות.':'חיבור האפליקציה מנותק · מעקב הבוט מושהה. ניתן להיכנס לקולמקס הרשמית. הניתוק עוצר את בקשות האפליקציה; אינו אישור לסגירת הסשן אצל הברוקר.';}
 render();
}
async function request(action){
 if(busy)return;busy=true;render();
 try{
  let token;try{token=localStorage.getItem('levi-colmex-device-v1');}catch{}
  if(action&&!token){if($('colmexManualDetails')){$('colmexManualDetails').open=true;$('colmexManualDetails').scrollIntoView?.({behavior:'smooth',block:'center'});}throw Error(messages.DEVICE_REQUIRED);}
  const r=await fetch('/.netlify/functions/colmex-connection',{method:action?'POST':'GET',cache:'no-store',signal:AbortSignal.timeout(15000),headers:action?{'Content-Type':'application/json',Authorization:'Bearer '+token}:{},...(action?{body:JSON.stringify({action})}:{})});
  let d;try{d=await r.json();}catch{throw Error('תגובה לא תקינה מהשרת. יש לבדוק את מצב החיבור לפני מעבר לקולמקס הרשמית.');}
  if(!r.ok||typeof d.enabled!=='boolean')throw Error(messages[d.error]||'לא ניתן לעדכן או לבדוק את החיבור: '+(d.error||'HTTP '+r.status));
  state=d;show();
 }catch(e){status.textContent=e.name==='TimeoutError'?'בדיקת החיבור לא הושלמה בזמן. לא ידוע אם השינוי נשמר; רענן לבדיקת המצב.':e.message;}
 finally{busy=false;render();}
}
connect.addEventListener('click',()=>request('connect'));
disconnect.addEventListener('click',()=>request('disconnect'));
request();setInterval(()=>{if(!document.hidden)request();},30000);setInterval(()=>{if(state&&!state.enabled&&Date.now()<=state.settledAt+1000&&!busy)show();},1000);
