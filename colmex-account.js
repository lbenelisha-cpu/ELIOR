// Broker credentials and broker bearer tokens never enter this browser module.
const $=id=>document.getElementById(id),root=$('brokerAccount');
let enabled=false,auto=true,generation=0,controller=null,timer=null,currentId='',refreshMs=60000;
try{localStorage.removeItem('levi-colmex-account-view-v1');}catch{}
function node(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(className)n.className=className;return n;}
function number(v){if(v===null||v===undefined||typeof v==='boolean'||typeof v==='string'&&!v.trim())return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function value(v,currency=''){const n=number(v);return n===null?'—':new Intl.NumberFormat('he-IL',{maximumFractionDigits:6}).format(n)+(currency?' '+currency:'');}
function clear(){ $('brokerMetrics').replaceChildren();$('brokerPositions').replaceChildren();$('brokerReadAt').textContent='';$('brokerFields').replaceChildren();$('brokerConnectionBadge').textContent='חשבון לא מאומת';}
function publish(data,error=null){if(typeof window!=='undefined'&&typeof CustomEvent==='function'){const detail={data,error,receivedAt:Date.now()};window.LEVI_COLMEX_ACCOUNT=detail;window.dispatchEvent(new CustomEvent('levi:colmex-account',{detail}));}}
function render(data){
 publish(data);
 clear();
 const select=$('brokerAccounts'),selected=data.selectedAccount;
 select.replaceChildren();const placeholder=node('option','בחר חשבון');placeholder.value='';select.append(placeholder);
 for(const a of data.accounts||[]){const option=node('option',a.name+' · '+a.id+' · '+(a.type||'סוג לא נמסר'));option.value=a.id;select.append(option);}
 select.value=selected?.id||'';select.hidden=(data.accounts||[]).length<2;
 $('brokerConnectionBadge').textContent=selected?'מחובר · תצוגת נתוני חשבון':'התחברות אומתה · תצוגת נתוני חשבון';
 $('brokerAccountStatus').textContent=!data.accounts?.length?'ההתחברות אומתה; קולמקס לא החזירה חשבונות זמינים.':!selected?'בחר חשבון כדי להציג את נתוניו.':'נתוני '+selected.name+' · '+(selected.type==='demo'?'חשבון דמו':selected.type==='live'?'חשבון LIVE':selected.type||'סוג חשבון לא נמסר')+' · סטטוס: '+(selected.status||'לא נמסר');
 $('brokerRefresh').disabled=false;
 if(!selected)return;
 currentId=selected.id;const currency=selected.currency||'',state=data.state||{};
 const metrics=[['יתרה ממומשת',state.balance],['יתרה חזויה · כולל רווח והפסד',state.projectedBalance],['כסף זמין למסחר',state.availableFunds],['מזומן בחשבון',state.cashBalance],['רווח / הפסד פתוח נטו',state.openNetPnL],['רווח / הפסד ממומש היום',state.todayNet],['פוזיציות פתוחות',(data.positions||[]).length]];
 for(const [label,v] of metrics){const article=node('article');article.append(node('span',label),node('strong',value(v,label==='פוזיציות פתוחות'?'':currency)));$('brokerMetrics').append(article);}
 $('brokerReadAt').textContent='קריאת חשבון: '+new Date(data.observedAt).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'})+' · שעון ישראל. מועד הקריאה אינו הבטחה לזמן עדכון הציטוטים אצל הברוקר.';
 const positions=data.positions||[];
 if(!positions.length)$('brokerPositions').append(node('p','אין פוזיציות פתוחות בתשובת הברוקר לחשבון שנבחר.','muted'));
 else {
  const table=node('table'),thead=node('thead'),head=node('tr');for(const label of ['נכס','כיוון','כמות','מחיר כניסה ממוצע','רווח / הפסד פתוח'])head.append(node('th',label));thead.append(head);table.append(thead);const body=node('tbody');
  for(const p of positions){const tr=node('tr');const direction={buy:'LONG',sell:'SHORT',long:'LONG',short:'SHORT'}[String(p.side).toLowerCase()]||String(p.side??'—');
   for(const v of [p.instrumentName??p.symbol??p.tradableInstrumentId??'—',direction,value(p.qty),value(p.avgPrice),value(p.unrealizedPl,currency)])tr.append(node('td',v));body.append(tr);
  }table.append(body);$('brokerPositions').append(table);
 }
 const dl=node('dl');for(const [key,v] of Object.entries(state)){dl.append(node('dt',key),node('dd',v===null?'—':String(v)));}$('brokerFields').append(dl);
}
async function refresh(){
 if(!enabled||controller)return;
 if(document.hidden){clearTimeout(timer);if(auto)timer=setTimeout(refresh,refreshMs);return;}
 const g=generation,c=new AbortController();controller=c;const timeout=setTimeout(()=>c.abort(),45000);clearTimeout(timer);
 $('brokerAccountStatus').textContent=$('brokerReadAt').textContent?'מעדכן נתוני חשבון · הנתונים מהקריאה הקודמת נשארים עד לסיום העדכון…':'קורא נתוני חשבון מקולמקס…';
 try{
  const q=new URLSearchParams({action:'snapshot'});if(currentId)q.set('accountId',currentId);
  const response=await fetch('/.netlify/functions/colmex-account?'+q,{cache:'no-store',signal:c.signal});
  const data=await response.json();if(g!==generation)return;
  if(!response.ok&&['AUTH_DENIED','AUTH_RESPONSE','ACCESS_DENIED'].includes(data.code))auto=false;
  if(!response.ok)throw Error(data.error||'לא ניתן לקרוא את החשבון');
  render(data);refreshMs=Math.max(60000,Number(data.refreshAfterMs)||60000);
 }catch(e){if(g===generation){publish(null,e.message);const previous=!!$('brokerReadAt').textContent;if(previous)$('brokerConnectionBadge').textContent='נתונים קודמים · העדכון נכשל';$('brokerAccountStatus').textContent=(e.name==='AbortError'?'קריאת החשבון ארכה זמן רב. נסה לרענן.':e.message)+(previous?' · מוצגים נתונים מהקריאה הקודמת, לא מצב חשבון מאומת כעת.':' · מצב הפוזיציות אינו ידוע.');refreshMs=Math.max(refreshMs,60000);}}
 finally{clearTimeout(timeout);if(g===generation){controller=null;if(enabled&&auto)timer=setTimeout(refresh,refreshMs);}}
}
$('brokerRefresh').addEventListener('click',()=>{auto=true;refresh();});
$('brokerAccounts').addEventListener('change',()=>{generation++;controller?.abort();controller=null;clearTimeout(timer);currentId=$('brokerAccounts').value;publish(null,'ממתין לחשבון שנבחר');clear();if(currentId)refresh();});
async function status(){
 try{const r=await fetch('/.netlify/functions/colmex-account?action=status',{cache:'no-store'});if(!r.ok)throw Error();const d=await r.json();
  enabled=d.credentialsConfigured===true;
  $('brokerSetupStatus').textContent=enabled?'תצוגת נתוני חשבון · חיבור אוטומטי ללא קוד צפייה.':'יש להגדיר בשרת את פרטי COLMEX_API_LOGIN ו־COLMEX_API_PASSWORD.';
  $('brokerRefresh').disabled=!enabled;
  if(enabled)refresh();
 }catch{$('brokerSetupStatus').textContent='בדיקת החיבור אינה זמינה כרגע. רענן את העמוד מאוחר יותר.';}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&enabled&&auto)refresh();});
status();
