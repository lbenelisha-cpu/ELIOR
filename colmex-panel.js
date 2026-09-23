(() => {
 const root=document.getElementById('colmex-panel');if(!root)return;
 root.innerHTML=`<h2>קולמקס · נכסים לניתוח</h2><p>נתונים ישירות מ־MT4. הסוכנים מדרגים לפי נרות חצי־שעתיים סגורים; כרגע אין שינוי בתיק הכספי ואין פקודות לברוקר.</p>
 <div class="grid two" aria-label="תקציב קולמקס מתוכנן"><div class="card"><h3>תוכנית NVDA</h3><p>תקציב מתוכנן: <b>1,000 USD</b></p><p>תקרת חשיפה: 1,000 USD</p><p>הגדרות שנקראו מהתוכנית הקיימת: צמיחה · יעד 80% (800 USD); איזון אוטומטי ומעבר בין נכסים פעילים בסימולציה הקיימת. בקולמקס טרם הופעל ביצוע.</p></div><div class="card"><h3>תוכנית QQQ</h3><p>תקציב מתוכנן: <b>1,000 USD</b></p><p>תקרת חשיפה: 1,000 USD</p><p>הגדרות שנקראו מהתוכנית הקיימת: צמיחה · יעד 80% (800 USD); איזון אוטומטי ומעבר בין נכסים פעילים בסימולציה הקיימת. בקולמקס טרם הופעל ביצוע.</p></div></div><p class="yellow">NVDA ו־QQQ הם נכסי התוכניות הקיימות; זמינות ומיפוי הנכסים בקולמקס טרם אומתו. תקציב כולל מתוכנן: 2,000 USD. טרם הוקצה בדמו; ביצוע העסקאות עדיין לא מחובר. יתרת 10,000 הדולר של הברוקר אינה תקציב התוכניות. החשיפה היא סך שווי העסקאות, כולל שורט, ולא הביטחונות בלבד.</p><div class="actions"><label for="colmex-key">מפתח צפייה של קולמקס </label><input id="colmex-key" type="password" autocomplete="off"><button id="colmex-connect" type="button">התחבר לקולמקס</button><button id="colmex-disconnect" type="button" class="secondary">נתק</button><button id="colmex-export" type="button" class="secondary" disabled>הורד מפרטי חוזים לבדיקה</button></div>
 <p id="colmex-status" role="status">ממתין לחיבור באמצעות מפתח הקריאה של קולמקס.</p><div id="colmex-summary"></div>
 <p class="yellow">אימות מועמד לניתוח אינו מאמת את עלויות החוזה. מעבר עתידי בסימולציה ידרוש גם 3 אימותים, ציון 60 לפחות ויתרון של 10 נקודות, בהתאם להגדרות התוכנית.</p>
 <label for="colmex-filter">חיפוש נכס </label><input id="colmex-filter" type="search" placeholder="שם או סמל אצל הברוקר">
 <div class="table"><table><thead><tr><th>נכס</th><th>תיאור</th><th>ציון</th><th>שוק / מגמה / סיכון / מומנטום</th><th>מרווח %</th><th>בדיקת חוזה</th></tr></thead><tbody id="colmex-rows"></tbody></table></div>
 <div class="actions"><button id="colmex-prev" type="button" class="secondary">הקודם</button><span id="colmex-page"></span><button id="colmex-next" type="button" class="secondary">הבא</button></div>
 <details><summary>10 סריקות קולמקס אחרונות</summary><div id="colmex-history"></div></details>
 <details><summary>נכסים שממתינים לנתונים</summary><div id="colmex-blocked"></div></details>
 <p class="muted">המפתח נשמר בזיכרון הלשונית בלבד ונמחק בניתוק או בסגירה. <a href="/colmex-market.html">פתיחת עמוד קולמקס המלא</a></p>`;
 const el=id=>document.getElementById('colmex-'+id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let token='',data=null,page=0,generation=0,controller=null;
 const number=x=>Number(x).toLocaleString('he-IL',{maximumFractionDigits:4});
 function render(){
  const term=el('filter').value.toLowerCase(),rows=(data?.candidates||[]).filter(x=>(x.symbol+' '+x.description).toLowerCase().includes(term));
  const pages=Math.max(1,Math.ceil(rows.length/10));page=Math.min(page,pages-1);
  const reports=new Map((data?.contracts?.reports||[]).map(x=>[x.symbol,x]));
  el('rows').innerHTML=rows.slice(page*10,page*10+10).map(x=>{
   const a=reports.get(x.symbol);const details=a?(a.unitConsistent?'יחידות עקביות; עלויות טרם אומתו. שווי לוט מזערי: '+number(a.minimumNotional)+' '+a.currency:(a.issues||[]).join(' · ')):'בדיקת החוזה אינה זמינה';
   return '<tr>'+[x.symbol,x.description,x.master,[x.market,x.trend,x.risk,x.momentum].join(' / '),number(x.spreadPercent),details].map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>';
  }).join('')||'<tr><td colspan="6">אין נכסים זמינים להצגה</td></tr>';
  el('page').textContent='עמוד '+(page+1)+' מתוך '+pages+' · '+rows.length+' נכסים';el('prev').disabled=page===0;el('next').disabled=page>=pages-1;
 }
 function clear(){data=null;page=0;render();el('summary').textContent='';el('history').textContent='';el('blocked').textContent='';el('export').disabled=true;}
 async function refresh(){
  if(!token||controller)return;const g=generation,c=new AbortController();controller=c;const timeout=setTimeout(()=>c.abort(),20000);
  try{const r=await fetch('/.netlify/functions/colmex-market',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:c.signal});const d=await r.json();if(g!==generation)return;if(!r.ok)throw Error(d.error||'לא ניתן לקרוא נתונים');
   data=d;render();el('export').disabled=false;
   el('status').textContent=d.complete?'התקבל מחזור איסוף לכל הנכסים':'האיסוף אינו שלם או שאינו עדכני; אין אימות חדש';
   el('summary').innerHTML='<p><b>'+d.candidates.length+' נכסים נותחו מתוך '+d.catalogCount+'</b> · עדכונים התקבלו עבור '+d.observed+' נכסים.</p><p>מועמד בסריקה האחרונה: '+esc(d.leader.symbol||'טרם נקבע')+' · '+d.leader.consecutive+'/3 · '+(d.leader.verified?'מאומת לניתוח':'לא מאומת כעת')+'</p><p>בדיקת מפרטים: '+(d.contracts?.unitConsistent||0)+' נכסים עם יחידות מחיר עקביות. העלויות טרם אומתו; מעברים כספיים אינם פעילים.</p>';
   el('history').innerHTML=d.history.slice(0,10).map(x=>'<p>'+esc(new Date(Number(x.bar_time)*1000).toLocaleString('he-IL'))+' · '+esc(x.leader)+' · '+esc(x.score)+'</p>').join('')||'אין סריקות שמורות';
   el('blocked').innerHTML=d.blocked.map(x=>'<p>'+esc(x.symbol)+' — '+esc(x.reason)+'</p>').join('')||'אין נכסים ממתינים';
  }catch(e){if(g===generation){clear();el('status').textContent='לא ניתן לאמת נתונים כעת: '+e.message;}}finally{clearTimeout(timeout);if(controller===c)controller=null;}
 }
 el('connect').onclick=()=>{generation++;controller?.abort();controller=null;token=el('key').value.trim();el('key').value='';clear();el('status').textContent=token?'מתחבר…':'הזן מפתח קריאה';refresh();};
 el('disconnect').onclick=()=>{generation++;controller?.abort();controller=null;token='';clear();el('status').textContent='קולמקס נותק מהתצוגה';};
 el('filter').oninput=()=>{page=0;render();};el('prev').onclick=()=>{page--;render();};el('next').onclick=()=>{page++;render();};
 el('export').onclick=async()=>{
  if(!token)return;const g=generation;el('export').disabled=true;
  try{const r=await fetch('/.netlify/functions/colmex-market?action=contracts',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(15000)});const d=await r.json();if(g!==generation)return;if(!r.ok)throw Error(d.error||'הייצוא נכשל');
   const url=URL.createObjectURL(new Blob([JSON.stringify(d,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='colmex-contracts.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
   el('status').textContent='קובץ מפרטי החוזים הורד. הקובץ אינו כולל מפתחות, יתרה או פוזיציות.';
  }catch(e){if(g===generation)el('status').textContent='לא ניתן לייצא: '+e.message;}finally{if(g===generation&&token)el('export').disabled=false;}
 };
 render();setInterval(refresh,30000);
})();
