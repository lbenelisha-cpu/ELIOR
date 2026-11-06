const $=id=>document.getElementById(id);
const endpoint='https://levi-binance.2-29-48-20.sslip.io/api/market-news';
const date=value=>Number.isFinite(value)?new Date(value).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}):'טרם בוצע';
const kinds={investment:'השקעות ורכישות',risk:'תקלות וסיכונים',price_move:'תנועת מחיר',report:'דיווח'};
let data=null,limit=40,busy=false,readOK=false;
const add=(tag,text,parent,cls='')=>{const node=document.createElement(tag);node.textContent=text;if(cls)node.className=cls;parent.append(node);return node;};
function link(parent,title,value){let url;try{url=new URL(value);}catch{return;}if(url.protocol!=='https:'||url.username||url.password||!['www.coindesk.com','cointelegraph.com','www.prnewswire.com'].includes(url.hostname))return;const a=add('a',title,parent);a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';}
function renderFeed(){
 if(!data)return;
 const query=$('search').value.trim().toLowerCase(),kind=$('kind').value,source=$('source').value;
 const filtered=data.items.filter(r=>(!kind||r.kind===kind)&&(!source||r.sourceId===source)&&(!query||[r.title,...r.assets.map(a=>a.id)].join(' ').toLowerCase().includes(query)));
 $('count').textContent=filtered.length+' דיווחים';$('feed').replaceChildren();$('more').hidden=filtered.length<=limit;
 if(!filtered.length)add('p','לא נמצאו דיווחים במסננים שנבחרו. היעדר דיווח בערוץ אינו מעיד שלא פורסמו חדשות.',$('feed'),'empty');
 for(const r of filtered.slice(0,limit)){
  const article=add('article','',$('feed'),'story'),tags=add('div','',article,'tags');
  add('span',kinds[r.kind]||'דיווח',tags,'tag');add('span',r.source,tags,'tag');
  if(r.group==='prnewswire')add('span','הודעת חברה',tags,'tag');
  if(r.uncertain)add('span','ניסוח מסויג · למעקב בלבד',tags,'tag');
  if(r.revised)add('span','דיווח שעודכן · ללא השפעה',tags,'tag');
  window.LEVI_NEWS_SUMMARY?.append(article,r);
  const heading=add('h3','',article);heading.dir='auto';link(heading,r.title,r.url);
  if(r.assets.length)add('div',r.assets.map(a=>a.id.replace('crypto:','').replace('stock:','מניית ')).join(' · ')+' — זיהוי לפי אזכור מפורש בכותרת',article,'asset');
  else add('div','ללא שיוך ברור לנכס במיפוי הנוכחי',article,'hint');
  add('div','פורסם: '+date(r.publishedAt)+' · נקלט לראשונה: '+date(r.firstSeenAt),article,'meta');
 }
}
function render(){
 const fresh=data.collectedAt&&Date.now()-data.collectedAt>=0&&Date.now()-data.collectedAt<=900000;
 $('status').textContent=(fresh&&readOK?'הערוץ מחובר':'המידע אינו עדכני')+' · איסוף אחרון: '+date(data.collectedAt)+(data.storageError?' · שמירת הנתונים דורשת טיפול':'');
 $('permission').textContent='חדשות משמשות לאיתות ולמעקב בלבד. אין השפעה על אישור, חסימה או סדר כניסה לעסקאות.';
 $('sources').replaceChildren();const selected=$('source').value;$('source').replaceChildren();const all=add('option','כל המקורות',$('source'));all.value='';
 for(const s of data.sources){
  const card=add('div','',$('sources'),'source');add('strong',s.name,card);const good=readOK&&s.status==='OK'&&Date.now()>=s.lastSuccessAt&&Date.now()-s.lastSuccessAt<900000;
  add('span',good?'מקור זמין':s.status?'מקור אינו זמין כעת':'ממתין לאיסוף',card,good?'good':'warn');
  if(!good&&s.error)add('small','סיבת האיסוף: '+({SOURCE_UNAVAILABLE:'המקור לא החזיר תוכן זמין לשרת',RATE_LIMITED:'המקור הגביל את קצב הבקשות',INVALID_FEED:'תוכן המקור אינו בפורמט התקין',FEED_TOO_LARGE:'התוכן גדול ממגבלת האיסוף'}[s.error]||s.error),card);add('small','הצלחה אחרונה: '+date(s.lastSuccessAt),card);if(!good&&s.nextAttemptAt)add('small','ניסיון איסוף הבא: '+date(s.nextAttemptAt),card);add('small','דיווחים באיסוף האחרון: '+(s.count??'—'),card);
  const option=add('option',s.name,$('source'));option.value=s.id;
 }
 $('source').value=selected;$('decisions').replaceChildren();
 const observations=readOK&&fresh&&!data.storageError?(data.attention||[]).filter(d=>d.active&&d.expiresAt>Date.now()):[];
 if(!observations.length)add('p','אין כרגע איתות חדשות עדכני במיפוי הקיים. היעדר איתות אינו אישור שאין חדשות.',$('decisions'),'hint');
 for(const d of observations){const box=add('div','',$('decisions'),'decision');add('strong',d.symbol+' · תשומת לב למעקב',box);add('p','נבדקו מקור, זמן ואזכור מפורש בכותרת. המידע לא מהווה אישור לעסקה.',box,'hint');if(d.matchingReports?.length>=2)add('p','נמצאה התאמה בפרטי אירוע בכותרות של שני מפרסמים; אינה אימות עצמאי של האירוע.',box,'hint');for(const e of d.evidence.filter(e=>e.active&&e.expiresAt>Date.now())){window.LEVI_NEWS_SUMMARY?.append(box,e);link(box,e.source+' · '+e.title,e.url);add('p',({UNCERTAIN:'ניסוח מסויג / שמועה · לא אומת',REVISED:'דיווח שעודכן · דורש בדיקה',COMPANY_OR_SYNDICATED:'הודעת חברה / תוכן מיוחס',SINGLE_REPORT:'דיווח יחיד'}[e.verification]||'דיווח למעקב')+' · פורסם '+date(e.publishedAt),box,'hint');}}

 renderFeed();
}
async function refresh(){
 if(busy)return;busy=true;$('refresh').disabled=true;
 try{const r=await fetch(endpoint,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();const next=await r.json();if(next.version!=='MARKET_NEWS_V1'||!Array.isArray(next.items)||!Array.isArray(next.sources)||!next.config)throw Error();data=next;readOK=true;render();}
 catch{readOK=false;$('status').textContent='ערוץ החדשות אינו זמין מהשרת כרגע. בהתקנה הראשונה יש להתקין את עדכון הערוץ בשרת Binance.';$('permission').textContent='לא ניתן לאמת כרגע את מצב ההפעלה.';$('decisions').replaceChildren();add('p','אין איתות עדכני להצגה.',$('decisions'),'hint');if(data){$('status').textContent+=' הכותרות המוצגות הן העותק האחרון שנקלט.';$('sources').replaceChildren();}else{$('feed').replaceChildren();add('p','כותרות אמיתיות יופיעו לאחר חיבור הערוץ.',$('feed'),'empty');}}
 finally{busy=false;$('refresh').disabled=false;}
}
for(const id of ['search','kind','source'])$(id).addEventListener('input',()=>{limit=40;renderFeed();});
$('more').addEventListener('click',()=>{limit+=40;renderFeed();});$('refresh').addEventListener('click',refresh);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});setInterval(()=>{if(!document.hidden)refresh();},60000);refresh();

setInterval(()=>{if(data&&!busy&&!document.hidden)render();},10000);
