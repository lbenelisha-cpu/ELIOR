const node=(tag,text,className)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(className)n.className=className;return n;};
const time=at=>Number.isFinite(at)?new Intl.DateTimeFormat('he-IL',{timeZone:'Asia/Jerusalem',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(at)):'—';
const num=(value,digits=4)=>Number.isFinite(value)?value.toLocaleString('en-US',{maximumFractionDigits:digits}):'—';
const actions={ENTER:'איתות כניסה',EXIT:'איתות יציאה',HOLD:'המשך החזקה',WAIT:'המתנה / אין כניסה',PROTECT:'עדכון הגנה'};
const stages={EVALUATION:'בדיקת אסטרטגיה',ORDER_INTENT:'כוונה שמורה · טרם ביצוע',ORDER_ATTEMPT:'נשלחה בקשת הוראה',ORDER_ACKNOWLEDGED:'התקבל אישור קבלה',ORDER_UNCERTAIN:'תוצאה ממתינה לאימות',ORDER_CANCELLED_BEFORE_WRITE:'בוטל לפני שליחה',BROKER_FILL:'ביצוע אומת אצל הברוקר',CLOSE_OBSERVED:'נצפתה סגירה · מחיר טרם אומת'};
const guidance={ENTRY_SUPPORT:'תמיכה בכיוון',EXIT_WARNING:'אזהרת יציאה',REVERSAL_PENDING:'היפוך שטרם אושר',WEAKENING:'מגמה נחלשת',MIXED:'מגמות חלוקות',FLAT:'ללא כיוון',BROAD_FLAT:'ללא כיוון רחב',UNAVAILABLE:'אין נתונים תקפים'};
const comparison={SUPPORTS:'תומך בהחלטה',OPPOSES:'כיוון מנוגד',MIXED:'חיווי חלקי',NOT_COMPARABLE:'ללא הכרעה להשוואה',UNAVAILABLE:'אין השוואה תקפה'};
const signed=value=>Number.isFinite(value)?(value>0?'+':'')+num(value,2)+'%':'—';
export function createDecisionJournal(host,{read}){
 const fold=node('details',null,'ma-journal-fold'),summary=node('summary','יומן השוואת החלטות · MA100 / MA200');
 const body=node('div',null,'ma-journal-body'),intro=node('p','החלטות שרת LIVE מול הממוצעים באותו זמן · תיעוד בלבד · LONG. היומן אינו משנה הוראות מסחר.','ma-journal-intro');
 const toolbar=node('form',null,'ma-journal-toolbar'),symbol=node('input'),label=node('label','סימול ');symbol.placeholder='כל הנכסים';symbol.maxLength=30;symbol.dir='ltr';symbol.setAttribute('aria-label','סינון היומן לפי סימול');label.append(symbol);
 const cadence=node('select'),cadenceLabel=node('label','תדירות ההשוואה ');for(const n of [10,20]){const option=node('option',n+' דקות');option.value=String(n);cadence.append(option);}cadenceLabel.append(cadence);
 const refresh=node('button','רענן יומן');refresh.type='submit';toolbar.append(label,cadenceLabel,refresh);
 const status=node('p','פתח כדי לקרוא את התיעוד השמור בשרת.','ma-journal-status');status.setAttribute('role','status');
 const stats=node('div',null,'ma-journal-stats'),wrap=node('div',null,'ma-journal-scroll'),table=node('table'),head=node('thead'),titles=node('tr'),tbody=node('tbody');
 for(const title of ['מועד · ישראל','נכס / החלטה','MA100 / MA200','השוואה','שינוי מחיר בהמשך'])titles.append(node('th',title));head.append(titles);table.append(head,tbody);wrap.append(table);wrap.tabIndex=0;wrap.setAttribute('aria-label','טבלת השוואת החלטות');
 const note=node('p','נרות 5 דקות סגורים; MA100 ו־MA200, שיפוע על 10 נרות (50 דקות). נשמרים שינויים בהחלטות ודגימה של מצב חוזר בכל 10 דקות. מוצגות עד 200 רשומות מ־24 השעות האחרונות. נתון חסר או מיושן מסומן ואינו הופך לאיתות. שינוי המחיר נמדד מהמחיר שנצפה בהחלטה למדידה הראשונה עד 5 דקות אחרי המועד המבוקש; זהו שינוי ברוטו במחיר, לא רווח נטו מעסקה. בקולמקס זמן המחיר הוא זמן קבלת הציטוט, ללא חותמת מקור של הברוקר.','ma-journal-note');
 body.append(intro,toolbar,status,stats,wrap,note);fold.append(summary,body);host.append(fold);let data=null,busy=false,generation=0;
 function render(){
  tbody.replaceChildren();stats.replaceChildren();if(!data)return;
  const minutes=Number(cadence.value||10),counts={SUPPORTS:0,OPPOSES:0,UNAVAILABLE:0};
  for(const row of data.rows){
   const check=row.checks.find(c=>c.checkMinutes===minutes);if(!check)continue;if(check.comparison in counts)counts[check.comparison]++;
   const tr=node('tr'),when=node('td',time(row.at)),decision=node('td'),ma=node('td'),result=node('td'),outcome=node('td');
   const action=row.stage==='BROKER_FILL'?(row.action==='ENTER'?'קנייה בוצעה':'מכירה בוצעה'):actions[row.action]||row.action;
   decision.append(node('strong',row.symbol+' · '+action),node('small',stages[row.stage]||row.stage),node('small',(row.origin==='MANUAL'?'פעולה ידנית · ':row.origin==='BROKER'?'דיווח ברוקר · ':'')+row.reason,'ma-journal-code'));
   if(row.price!=null)decision.append(node('small','מחיר '+num(row.price,8)+(row.priceFresh?'':' · ללא מחיר בסיס עדכני')));
   ma.append(node('strong',guidance[check.state]||check.state));
   if(check.status==='READY')ma.append(node('small','MA100: '+num(check.ma100?.average,8)+' · '+num(check.ma100?.angle,1)+'°'),node('small','MA200: '+num(check.ma200?.average,8)+' · '+num(check.ma200?.angle,1)+'°'));
   else ma.append(node('small',check.status));
   ma.append(node('small','נר המדידה: '+time(check.asOf)));
   const badge=node('span',comparison[check.comparison]||check.comparison,'ma-journal-badge');badge.dataset.state=check.comparison;result.append(badge);
   for(const observation of row.outcomes||[]){const item=node('small',observation.minutes+' דק׳: '+(observation.status==='OBSERVED'?signed(observation.changePct):observation.status==='PENDING'?'טרם הגיע המועד':observation.status==='WAIT_OBSERVATION'?'ממתין למדידה':'אין מדידה תקפה'));if(observation.status==='OBSERVED'){item.title='נמדד בפועל: '+time(observation.at);item.dataset.direction=observation.changePct>0?'up':observation.changePct<0?'down':'flat';}outcome.append(item);}
   tr.append(when,decision,ma,result,outcome);tbody.append(tr);
  }
  for(const [key,title]of [['SUPPORTS','תמיכה'],['OPPOSES','כיוון מנוגד'],['UNAVAILABLE','חסר להשוואה']]){const cell=node('div');cell.append(node('strong',String(counts[key])),node('span',title+' · ברשומות המוצגות'));stats.append(cell);}
  const trouble=data.storageError||data.dropped?' · קיימת בעיית שמירה; התיעוד עשוי להיות חלקי':data.stale?' · התיעוד לא התעדכן לאחרונה':'';
  status.textContent=data.health?'תחילת תיעוד '+time(data.health.startedAt)+' · שמירה אחרונה '+time(data.health.lastPersistedAt)+(data.health.lastRecordAt?' · החלטה אחרונה '+time(data.health.lastRecordAt):'')+' · '+data.rows.length+' מתוך '+data.total+' רשומות בטווח'+(data.pending?' · '+data.pending+' ממתינות לשמירה':'')+trouble:'התיעוד הופעל; ממתינים לשמירה הראשונה בשרת.';
  status.dataset.state=trouble?'warning':'ready';
  if(!data.rows.length){const tr=node('tr'),td=node('td','עדיין אין החלטות מתועדות בטווח או בסימול שנבחר. מחוץ לשעות המסחר בקולמקס ייתכן שלא יהיו בדיקות כניסה חדשות.');td.colSpan=5;tr.append(td);tbody.append(tr);}
 }
 async function load(){if(busy)return;const request=++generation;busy=true;refresh.disabled=true;status.textContent='קורא תיעוד מהשרת…';try{
   const query=symbol.value.trim().toUpperCase();if(query&&!/^[A-Z0-9][A-Z0-9._-]{0,29}$/.test(query))throw Error('INVALID_SYMBOL');
   const response=await read(query);if(request!==generation)return;if(!response?.ok||!Array.isArray(response.rows))throw Error('INVALID_RESPONSE');data=response;render();
  }catch(error){if(request!==generation)return;data=null;tbody.replaceChildren();stats.replaceChildren();status.dataset.state='warning';status.textContent=error.status===401?'נדרש חיבור המכשיר הקיים לצפייה ביומן הפרטי.':error.message==='INVALID_SYMBOL'?'יש להזין סימול תקין, למשל BTCUSDT או AAPL.':'לא ניתן לקרוא את היומן כרגע. אפשר לנסות לרענן.';}finally{if(request===generation){busy=false;refresh.disabled=false;}}}
 fold.addEventListener('toggle',()=>{if(fold.open&&!data)void load();});toolbar.addEventListener('submit',event=>{event.preventDefault();void load();});cadence.addEventListener('change',render);
 return {load,clear(){generation++;busy=false;refresh.disabled=false;data=null;tbody.replaceChildren();stats.replaceChildren();status.textContent='רענן כדי לקרוא את היומן בחיבור הנוכחי.';}};
}
const host=globalThis.document?.getElementById('maDecisionJournal');
if(host){
 const platform=host.dataset.platform;
 const panel=createDecisionJournal(host,{read:async symbol=>{
  let url,headers={};
  if(platform==='BINANCE'){const upstream=window.API_BASE+'/api/binance-ma-audit'+(symbol?'?symbol='+encodeURIComponent(symbol):'');url=window.binanceReadUrl(upstream);headers=window.binanceReadHeaders(upstream);}
  else{url='/.netlify/functions/colmex-ma-audit'+(symbol?'?symbol='+encodeURIComponent(symbol):'');let token;try{token=localStorage.getItem('levi-colmex-device-v1');}catch{}if(token)headers.Authorization='Bearer '+token;}
  const response=await fetch(url,{headers,cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok){const error=Error('AUDIT_READ');error.status=response.status;throw error;}return response.json();
 }});
 window.addEventListener('levi:binance-dashboard',event=>{if(event.detail?.unauthorized)panel.clear();});
 for(const event of ['trade-device-connected','trade-device-expired'])window.addEventListener(event,()=>panel.clear());
}
