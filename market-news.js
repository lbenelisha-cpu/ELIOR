const $=id=>document.getElementById(id);
const endpoint='https://levi-binance.2-29-48-20.sslip.io/api/market-news';
const date=value=>Number.isFinite(value)?new Date(value).toLocaleString('he-IL'):'טרם בוצע';
const kinds={investment:'השקעות ורכישות',risk:'תקלות וסיכונים',price_move:'תנועת מחיר',report:'דיווח'};
let data=null,limit=40,busy=false;
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
  const heading=add('h3','',article);heading.dir='auto';link(heading,r.title,r.url);
  if(r.assets.length)add('div',r.assets.map(a=>a.id.replace('crypto:','').replace('stock:','מניית ')).join(' · ')+' — זיהוי לפי אזכור מפורש בכותרת',article,'asset');
  else add('div','ללא שיוך ברור לנכס במיפוי הנוכחי',article,'hint');
  add('div','פורסם: '+date(r.publishedAt)+' · נקלט לראשונה: '+date(r.firstSeenAt),article,'meta');
 }
}
function render(){
 const fresh=data.collectedAt&&Date.now()-data.collectedAt>=0&&Date.now()-data.collectedAt<=900000;
 $('status').textContent=(fresh?'הערוץ מחובר':'המידע אינו עדכני')+' · איסוף אחרון: '+date(data.collectedAt)+(data.storageError?' · שמירת הנתונים דורשת טיפול':'');
 $('permission').textContent=data.executionEnabled?'הרשאת השפעה על כניסות אוטומטיות בבייננס פעילה · התחלה: '+date(data.config.enabledAfter):data.config.enabled?'כללי החדשות מופעלים, אך המסחר האוטומטי ב־LIVE אינו פעיל כרגע.':'איסוף ומעקב בלבד · השפעה על עסקאות אינה מופעלת בשרת.';
 $('sources').replaceChildren();const selected=$('source').value;$('source').replaceChildren();const all=add('option','כל המקורות',$('source'));all.value='';
 for(const s of data.sources){
  const card=add('div','',$('sources'),'source');add('strong',s.name,card);const good=s.status==='OK'&&Date.now()-s.lastSuccessAt<=900000;
  add('span',good?'מקור זמין':s.status?'מקור אינו זמין כעת':'ממתין לאיסוף',card,good?'good':'warn');
  add('small','הצלחה אחרונה: '+date(s.lastSuccessAt),card);add('small','דיווחים באיסוף האחרון: '+(s.count??'—'),card);
  const option=add('option',s.name,$('source'));option.value=s.id;
 }
 $('source').value=selected;$('decisions').replaceChildren();
 const decisions=fresh&&!data.storageError?(data.decisions||[]).filter(d=>d.action!=='NONE'):[];
 if(!decisions.length)add('p',fresh?'אין כרגע אירוע תואם בתוקף שמשנה עדיפות או חוסם כניסה. זה אינו אישור לקנות או אישור שאין סיכון.':'אין מידע עדכני להצגת השפעה על כניסות.',$('decisions'),'hint');
 for(const d of decisions){const box=add('div','',$('decisions'),'decision');add('strong',d.symbol+' · '+(d.action==='BLOCK'?'חסימת כניסה חדשה':'עדיפות בין איתותים טכניים מתאימים'),box);add('p',data.executionEnabled?'הכלל משתתף בהחלטת הכניסה; ביצוע עסקה תלוי בכל בדיקות המסחר.':'הכלל זמין, אך ביצוע אוטומטי אינו פעיל.',box,'hint');for(const e of d.evidence)link(box,e.source+' · '+e.title,e.url);}
 renderFeed();
}
async function refresh(){
 if(busy)return;busy=true;$('refresh').disabled=true;
 try{const r=await fetch(endpoint,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();const next=await r.json();if(next.version!=='MARKET_NEWS_V1'||!Array.isArray(next.items)||!Array.isArray(next.sources)||!next.config)throw Error();data=next;render();}
 catch{$('status').textContent='ערוץ החדשות אינו זמין מהשרת כרגע. בהתקנה הראשונה יש להתקין את עדכון הערוץ בשרת Binance.';$('permission').textContent='לא ניתן לאמת כרגע את מצב ההפעלה.';$('decisions').replaceChildren();add('p','לא מוצגת השפעה עדכנית על החלטות.',$('decisions'),'hint');if(data){$('status').textContent+=' הכותרות המוצגות הן העותק האחרון שנקלט.';$('sources').replaceChildren();}else{$('feed').replaceChildren();add('p','כותרות אמיתיות יופיעו לאחר חיבור הערוץ.',$('feed'),'empty');}}
 finally{busy=false;$('refresh').disabled=false;}
}
for(const id of ['search','kind','source'])$(id).addEventListener('input',()=>{limit=40;renderFeed();});
$('more').addEventListener('click',()=>{limit+=40;renderFeed();});$('refresh').addEventListener('click',refresh);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});setInterval(()=>{if(!document.hidden)refresh();},60000);refresh();
