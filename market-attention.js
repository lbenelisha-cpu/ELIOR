/* Display and chart selection only. Optional headline translation is isolated in news-summary.js. */
(()=>{
 const panel=document.getElementById('marketAttentionPanel');if(!panel)return;
 const add=(tag,text,parent,cls='')=>{const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;parent.append(el);return el;};
 const date=v=>Number.isFinite(v)?new Date(v).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem'}):'טרם נבדק';
 const num=v=>Number.isFinite(v)?v.toLocaleString('he-IL',{maximumFractionDigits:5}):'—';
 const reasons={NEAR_CHANNEL_BOUNDARY:'קרוב לגבול התעלה',CHANNEL_OBSERVED:'תעלה במעקב',WAIT_CHANNEL_PIVOTS:'ממתין לנקודות קיצון',WAIT_TWO_TOUCHES:'טרם אושרו שתי נגיעות בכל צד',WAIT_HISTORY:'אין 50 נרות סגורים לבדיקה',GAPPED_HISTORY:'חסרים נרות ברצף',INVALID_HISTORY:'נתוני הנרות אינם תקינים',STALE_HISTORY:'נרות לא עדכניים',HISTORY_UNAVAILABLE:'לא התקבלו נרות מהמקור',WAIT_OBSERVATION:'ממתין לסריקת תצפיתן',STALE_OBSERVATION:'התצפית התיישנה',LIVE_OBSERVER_ONLY:'התצפיתן הטכני פועל במצב LIVE',OBSERVER_STORAGE_UNAVAILABLE:'שמירת התצפיות דורשת בדיקה',TWO_TOUCHES_EACH_SIDE:'שתי נגיעות בכל צד',REGRESSION:'נתוני רגרסיה',VOLUME_DATA:'נתוני מחזור',VOLUME_RATIO:'מחזור ×1.5 מהממוצע',LIQUIDITY:'מחזור כספי ממוצע של 10,000 USDT'};
 const verification={SINGLE_REPORT:'דיווח יחיד · מקור, זמן ושיוך נבדקו',COMPANY_OR_SYNDICATED:'הודעת חברה / תוכן מיוחס · ללא אימות עצמאי',UNCERTAIN:'ניסוח מסויג / שמועה · לא אומת',REVISED:'כותרת שתוקנה · דורשת בדיקה נוספת'};
 let snapshot=null,longPolicy=null,receivedAt=0,query='',all=false;
 const head=add('div','',panel,'attention-head');panel.replaceChildren(head);
 const heading=add('div','',head);add('span','חדשות + תצפית טכנית',heading,'attention-kicker');add('h2','איתותים ותצפיתנים',heading);
 const newsLink=add('a','ערוץ החדשות ↗',head);newsLink.href='/market-news.html';
 add('p','איתות למעקב בלבד. החדשות אינן מאשרות, חוסמות או מתעדפות כניסה לעסקה. התצפיתן מציג נתונים שנבדקו; החלטות המסחר נשארות לפי הכללים וההגנות.',panel,'attention-note');
 const status=add('p','ממתין למידע מהשרת. נדרש חיבור המכשיר לצפייה בתצפיות.',panel,'attention-status');status.setAttribute('role','status');
 const controls=add('div','',panel,'attention-controls'),label=add('label','חיפוש נכס ',controls),search=add('input','',label);search.type='search';search.placeholder='ETHUSDT / NVDABUSDT';search.dir='ltr';
 const toggle=add('button','הצג את כל הנכסים',controls);toggle.type='button';
 const cards=add('div','',panel,'attention-cards'),sources=add('details','',panel,'attention-sources');add('summary','מקורות, כיסוי ויומן תצפיות',sources);const sourceBody=add('div','',sources);
 const link=(parent,row)=>{try{const u=new URL(row.url);if(u.protocol!=='https:'||u.username||u.password||u.port||!['www.coindesk.com','cointelegraph.com','www.prnewswire.com'].includes(u.hostname))return;const a=add('a',row.title,parent);a.dir='auto';a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';}catch{}};
 const entryReason=value=>window.LEVI_FUTURES_TABLE?.reason(value)||reasons[value]||value||'ממתין לבדיקה';
 const entryTracker=window.LEVI_ENTRY_CHECKLIST?.createTracker();
 function checklist(host,input){
  const view=entryTracker?.update(input)||window.LEVI_ENTRY_CHECKLIST?.project(input);if(!view)return;
  const progress=view.status==='refreshing'?view.previousCount+'/'+view.total+' בבדיקה האחרונה · ממתין לעדכון':view.status==='recorded'&&!view.dataPending?view.count+'/'+view.total+' אושרו בבדיקה':'ממתין לעדכון נתונים';
  add('p','תנאי כניסה בתעלה · '+progress,host,'attention-check-summary');
  const list=add('ul','',host,'attention-checklist');list.setAttribute('aria-label','תנאי כניסה '+input.side);
  for(const row of view.rows){
   const item=add('li','',list,'attention-check '+row.state);item.dataset.condition=row.id;item.dataset.state=row.state;
   const marker={passed:'✓',waiting:'○',unknown:'—',blocked:'!',previous_passed:'✓',previous_waiting:'○',previous_unknown:'—'}[row.state];
   const label={passed:'התקיים בבדיקה',waiting:'טרם התקיים',unknown:row.id==='execution'?'ממתין לבדיקה סופית':'טרם אומת',blocked:'הביצוע חסום',previous_passed:'אושר בבדיקה הקודמת · מתעדכן',previous_waiting:'המתין בבדיקה הקודמת · מתעדכן',previous_unknown:'טרם אומת · מתעדכן'}[row.state];
   const icon=add('span',marker,item,'attention-check-icon');icon.setAttribute('aria-hidden','true');
   const body=add('span','',item);add('span',row.label,body);add('small',label,body);
  }
  if(view.status!=='recorded')add('small',view.status==='refreshing'?'מוצגת הבדיקה מ־'+date(view.previousAt)+' בזמן הרענון. הסימונים הקודמים אינם אישור כניסה כעת.':view.status==='unsupported'?'ממתין לאימות מסלול הכניסה מהשרת':view.status==='stale'?'אין בדיקת כניסה עדכנית · הסימונים נוקו':'תוצאת השרת אינה מפרטת אילו תנאים עברו',host,'attention-check-note');
 }
 function render(){
  const now=Date.now(),transport=snapshot&&now-receivedAt<90000&&now>=receivedAt&&now-snapshot.checkedAt<90000&&now>=snapshot.checkedAt;
  const expanded=new Set(Array.from(cards.querySelectorAll('details[open]')).map(x=>x.dataset.symbol));cards.replaceChildren();sourceBody.replaceChildren();
  if(!snapshot){entryTracker?.clear();status.textContent='אין תצפית עדכנית להצגה. חבר את המכשיר; אם הוא מחובר, יש לוודא שהשרת מעודכן.';return;}
  if(!transport||snapshot.mode!=='live')entryTracker?.clear();
  entryTracker?.retain(snapshot.rows.map(r=>r.symbol));
  const rows=snapshot.rows.map(r=>{const news={...r.news,active:transport&&r.news.active&&r.news.expiresAt>now};const technical={...r.technical,ready:transport&&r.technical.ready&&r.technical.expiresAt>now};technical.watch=technical.ready&&r.technical.watch;if(r.technical.ready&&!technical.ready)technical.reason='STALE_OBSERVATION';return {...r,news,technical,active:news.active||technical.watch};});
  const active=rows.filter(r=>r.active).length,scanned=rows.filter(r=>r.technical.ready).length;
  status.textContent=(transport?'עדכון שרת: '+date(snapshot.checkedAt):'העדכון התיישן · האיתותים הפעילים הוסרו')+' · '+active+' נכסים לתשומת לב · '+scanned+'/'+rows.length+' תצפיות טכניות עדכניות'+(snapshot.storageError?' · שגיאת שמירת תצפיות':'');
  let shown=rows.filter(r=>!query||r.symbol.includes(query));if(!all&&!query)shown=shown.filter(r=>r.active).slice(0,8);
  toggle.textContent=all?'הצג איתותים בלבד':'הצג את כל הנכסים';toggle.setAttribute('aria-pressed',String(all));
  if(!shown.length)add('p',query?'אין נכס תואם ביקום המעקב.':'אין כרגע איתות טרי ברשימת המעקב. אפשר לפתוח את כל הנכסים ולראות מה נבדק ומה חסר.',cards,'attention-note');
  for(const r of shown){
   const card=add('article','',cards,'attention-card'+(r.active?' attention-active':'')),top=add('div','',card,'attention-card-head');
   add('strong',r.symbol,top);const button=add('button','פתח גרף Spot',top);button.type='button';button.onclick=()=>window.dispatchEvent(new CustomEvent('levi-dashboard-select',{detail:r.symbol}));
   const title=r.news.active?'איתות חדשות · תשומת לב מוגברת':r.technical.watch?'תצפיתן: '+reasons.NEAR_CHANNEL_BOUNDARY:reasons[r.technical.reason]||'מעקב';
   add('p',title,card,'attention-label');const t=r.technical;
   if(snapshot.sharedWatchPolicy?.version==='SHARED_LONG_SHORT_WATCH_V1'){
    const checks=add('div','',card,'attention-entry-checks'),long=add('div','',checks),short=add('div','',checks),o=r.shortObservation;
    add('strong','LONG · '+r.symbol,long);const ld=r.longDecision,lf=transport&&ld&&now>=ld.at&&now-ld.at<90000;
    add('p','בדיקה: '+(lf?entryReason(ld.reason):'ממתין לבדיקה עדכנית'),long);
    const longBlocker=transport?(r.entryBlockers?.long||(lf?ld.blocker:null)):null;
    add('small','ביצוע: '+(longBlocker?entryReason(longBlocker):'כפוף לבדיקה סופית'),long);
    const longSupported=snapshot.mode==='live'&&longPolicy?.requested===true&&longPolicy.version==='CHANNEL_PRIMARY_INTRABAR_V2'&&longPolicy.period===50&&longPolicy.minVolumeRatio===1.5&&longPolicy.minMeanDollarVolume===10000&&longPolicy.consolidationPolicy?.version==='CHANNEL_CONSOLIDATION_V1';
    checklist(long,{symbol:r.symbol,marketSymbol:r.symbol,side:'LONG',reason:ld?.reason,at:ld?.at,now,transport,supported:longSupported,blocker:longBlocker});
    add('small','בדיקה אחרונה: '+date(ld?.at),long);
    add('strong','SHORT · '+(o?.futuresSymbol||'חוזה לא מאומת'),short);
    const sf=transport&&o&&o.at<=now&&now-o.at<180000&&o.expiresAt>now;
    add('p','בדיקה: '+(!transport?'העדכון התיישן':!o?'ממתין למיפוי חוזה':!o.available?entryReason(o.mappingReason):sf?entryReason(o.reason):entryReason(o.at?'STALE_SHORT_OBSERVATION':'WAIT_SHORT_OBSERVATION')),short);
    const shortBlocker=transport?r.entryBlockers?.short:null;
    add('small','ביצוע: '+(shortBlocker?entryReason(shortBlocker):'כפוף לבדיקה סופית'),short);
    checklist(short,{symbol:r.symbol,marketSymbol:o?.futuresSymbol,side:'SHORT',reason:o?.reason,at:o?.at,expiresAt:o?.expiresAt,now,transport,supported:snapshot.mode==='live'&&o?.available===true&&o.observationOnly===true&&o.spotSymbol===r.symbol&&/^[A-Z0-9]{2,24}USDT$/.test(o.futuresSymbol||''),blocker:shortBlocker});
    add('small','בדיקה אחרונה: '+date(o?.at),short);
    add('small','✓ התקיים בבדיקה · ○ ממתין · — טרם אומת. הבדיקה נעצרת בתנאי הראשון שלא עבר; לפני ביצוע כל התנאים נבדקים מחדש.',card,'attention-check-legend');
   }
   if(t.ready){
    add('p','Spot · 50 נרות לפני נר המדידה · '+date(t.dataAt),card,'attention-note');
    add('p',t.channel?'תעלת קיצון: '+t.channel.highTouches+' נגיעות למעלה / '+t.channel.lowTouches+' למטה · '+(t.channel.confirmed?'מאושרת':'זמנית'):'תעלת קיצון: אין תעלה תקפה',card);
    add('p','רגרסיה: '+({UP:'עולה',DOWN:'יורדת',FLAT:'ללא כיוון'}[t.regression?.side]||'אין נתון')+' · מחזור הנר הסגור האחרון ×'+num(t.volume?.ratio)+' לעומת ממוצע 20 נרות',card);
   }else add('p',transport?(reasons[t.reason]||'התצפית התיישנה'):'אין תצפית טכנית עדכנית',card,'attention-note');
   const first=r.news.evidence?.[0];if(first){const story=add('div','',card,'attention-story');window.LEVI_NEWS_SUMMARY?.append(story,first);link(story,first);add('small',first.source+' · '+date(first.publishedAt)+(r.news.active?'':' · אינו איתות עדכני'),story);}
   const details=add('details','',card);details.dataset.symbol=r.symbol;details.open=expanded.has(r.symbol);add('summary','מה נאסף ונבדק',details);
   if(t.ready){add('p','נר המדידה נסגר במחיר '+num(t.price)+'. גבול עליון '+num(t.channel?.upper)+'; תחתון '+num(t.channel?.lower)+'; מרכז רגרסיה '+num(t.regression?.center)+'.',details);add('p','מחזור כספי ממוצע ל־20 נרות: '+num(t.volume?.meanDollarVolume)+' USDT. חסר בבדיקה: '+(t.missing?.length?t.missing.map(x=>reasons[x]||x).join(' · '):'אין חוסר במדדים המוצגים; אין בכך אישור עסקה')+'.',details);}
   add('p','בדיקת תצפיתן אחרונה: '+date(t.checkedAt),details,'attention-note');
   for(const e of r.news.evidence||[]){const story=add('div','',details,'attention-story');window.LEVI_NEWS_SUMMARY?.append(story,e);link(story,e);add('small',verification[e.verification]||'דיווח למעקב',story);add('small','פורסם '+date(e.publishedAt)+' · נקלט '+date(e.firstSeenAt)+' · המקור נבדק '+date(e.checkedAt),story);}
   if(r.news.matchingReports?.length>=2)add('p','נמצאו פרטי אירוע תואמים בכותרות של שני מפרסמים. זו הצלבה של כותרות, לא אימות עצמאי של האירוע.',details);
   if(!r.news.covered)add('p','אין מיפוי חדשות מפורש לנכס זה בגרסה הנוכחית.',details);
   for(const [name,d,age] of [['LONG Spot',r.longDecision,90000],['SHORT Futures',r.shortDecision,120000]])add('p',name+': '+(transport&&d&&now-d.at>=0&&now-d.at<age?(d.blocker||d.reason)+' · '+date(d.at):'אין החלטת מסחר עדכנית להצגה'),details,'attention-note');
  }
  add('p','הכיסוי מוגבל למקורות ולנכסים הממופים. אין דיווח אינו אישור שאין חדשות. נבדקים מבנה הפיד, קישור, זמן ואזכור מפורש בכותרת; תוכן הכתבה המלא אינו מאומת.',sourceBody);
  for(const s of snapshot.sourceStatus||[])add('p',s.name+' · '+(transport&&s.ok&&now-s.lastSuccessAt<900000?'זמין':'לא זמין / לא עדכני')+' · הצלחה אחרונה '+date(s.lastSuccessAt),sourceBody);
  add('p','מצב מסלול SHORT: '+(transport?snapshot.shortReason||'אין מידע':'אין מידע עדכני')+'. נתוני התעלות למעלה נמדדים ב־Spot; אינם אישור למסחר Futures.',sourceBody);
  for(const e of snapshot.events||[])add('p',date(e.at)+' · '+e.symbol+' · '+(reasons[e.reason]||e.reason),sourceBody,'attention-note');
 }
 search.oninput=()=>{query=search.value.trim().toUpperCase();render();};toggle.onclick=()=>{all=!all;render();};
 window.addEventListener('levi:binance-agent',e=>{snapshot=e.detail?.marketAttention?.policy?.version==='MARKET_ATTENTION_V1'?e.detail.marketAttention:null;longPolicy=e.detail?.config?.channelPrimary||null;receivedAt=Date.now();render();});
 window.addEventListener('trade-device-expired',()=>{snapshot=null;longPolicy=null;render();});
 setInterval(()=>{if(snapshot&&!document.hidden)render();},10000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)render();});
 if(window.LEVI_AGENT_SNAPSHOT?.marketAttention){snapshot=window.LEVI_AGENT_SNAPSHOT.marketAttention;longPolicy=window.LEVI_AGENT_SNAPSHOT.config?.channelPrimary||null;receivedAt=Date.now();render();}
})();
