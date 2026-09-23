(() => {
 let generation=0,controller=null;
 const el=()=>document.getElementById('colmex-execution-state');
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=x=>typeof x==='number'&&Number.isFinite(x)?x.toLocaleString('he-IL',{style:'currency',currency:'USD'}):'לא זמין';
 const statuses={issued:'נשלחה ל־MT4; ממתין לאישור ביצוע',filled:'ביצוע אושר בנתוני הברוקר',rejected:'נחסמה בבדיקה או נדחתה על ידי הברוקר',uncertain:'תוצאה לא ידועה — ביצוע נוסף חסום עד בירור'};
 function clear(){generation++;controller?.abort();controller=null;if(el())el().innerHTML='<p>התחבר באמצעות מפתח הקריאה להצגת מצב שתי תוכניות הדמו.</p>';}
 async function refresh(token){
  if(!el()||controller)return;const g=generation,c=new AbortController();controller=c;const timeout=setTimeout(()=>c.abort(),15000);
  try{
   const r=await fetch('/.netlify/functions/colmex-execution',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:c.signal});const d=await r.json();if(g!==generation)return;
   if(!r.ok)throw Error(d.error||'שירות הביצוע אינו זמין');
   const pending=d.commands.some(x=>['issued','uncertain'].includes(x.status));
   const state=d.stale?'אין דיווח עדכני מ־MT4':pending?'ממתין לבירור או לאישור הוראה':!d.enabled?'הביצוע כבוי בשרת':!d.terminalEnabled?'הביצוע כבוי ב־MT4':'הביצוע בדמו מופעל — בכפוף לכללי הסוכנים';
   const programs=d.summary?.programs||[];
   el().innerHTML='<h3>שתי תוכניות צמיחה · דמו קולמקס</h3><p><b>'+esc(state)+'</b></p><p>חשבון 102598 · תקציב כולל 10,000 דולר · חשיפה נוכחית של התוכניות: '+money(d.summary?.totalExposure)+'</p><p>שתי תוכניות לוגיות בחשבון דמו משותף. יעד לכל תוכנית: עד 4,000 דולר; תקרה: עד 5,000 דולר. הפסדים מקטינים את התקציב הזמין.</p>'+
    (programs.length?'<div class="grid two">'+programs.map(p=>'<div class="card"><h3>'+esc(p.label)+'</h3><p>מסלול: צמיחה · תקציב התחלתי '+money(p.budget)+'</p><p>נכס נוכחי: '+esc(p.symbol||'מזומן — אין החזקה')+'</p><p>חשיפה '+money(p.exposure)+' · יעד '+money(p.target)+' · תקרה זמינה '+money(p.cap)+'</p><p>רווח/הפסד ממומש '+money(p.realized)+' · פתוח '+money(p.floating)+'</p><p>שווי תוכנית '+money(p.equity)+'</p><p>'+esc(p.status)+' · אימותים '+esc(p.confirmations)+'/3</p></div>').join('')+'</div>':'<p>ממתין לדיווח ראשון של רכיב הביצוע. אין כאן עדיין אישור להפעלה.</p>')+
    '<p>דיווח אחרון: '+esc(d.receivedAt?new Date(d.receivedAt).toLocaleString('he-IL'):'טרם התקבל')+'</p><p class="muted">חשיפה נבדקת לפני כל קנייה; שינויי מחיר ופערי מסחר עשויים לגרום לחריגה זמנית. צמצום דורש MT4 מחובר והרשאת ביצוע. עמלות וריבית מוצגות לפי דיווחי הברוקר, לא כאומדן מאומת מראש.</p>'+
    '<h3>עסקאות פתוחות בדמו</h3><div class="table"><table><thead><tr><th>תוכנית</th><th>כרטיס</th><th>נכס</th><th>לוטים</th><th>רווח/הפסד כולל עלויות מדווחות</th></tr></thead><tbody>'+
    (d.orders.slice(0,10).map(o=>'<tr><td>'+esc(o.magic-31025980)+'</td><td>'+esc(o.ticket)+'</td><td>'+esc(o.symbol)+'</td><td>'+esc(o.lots)+'</td><td>'+money(o.profit+o.swap+o.commission)+'</td></tr>').join('')||'<tr><td colspan="5">'+(d.receivedAt?'אין עסקאות מדווחות':'ממתין לנתוני הברוקר')+'</td></tr>')+'</tbody></table></div>'+
    '<h3>יומן ביצוע · 10 הוראות אחרונות</h3>'+d.commands.map(x=>'<p>'+esc(new Date(x.created_at).toLocaleString('he-IL'))+' · תוכנית '+esc(x.command.program)+' · '+esc(x.command.action)+' '+esc(x.command.symbol)+' · '+esc(x.command.lots)+' לוטים · '+esc(statuses[x.status]||x.status)+(x.result?.error?' · קוד '+esc(x.result.error):'')+'</p>').join('')+
    '<details><summary>10 החלטות ביצוע אחרונות</summary>'+d.scans.map(x=>'<p>'+esc(new Date(Number(x.bar_time)*1000).toLocaleString('he-IL'))+' · '+esc(x.scan.programs.map(p=>'תוכנית '+p.id+': '+p.reason+' ('+p.confirmed+'/3)').join(' | '))+'</p>').join('')+'</details>';
  }catch(e){if(g===generation&&el())el().innerHTML='<p class="yellow">לא ניתן לאמת את מצב הביצוע: '+esc(e.message)+'. אין להסיק מכך שהפוזיציות סגורות.</p>';}
  finally{clearTimeout(timeout);if(controller===c)controller=null;}
 }
 window.ColmexExecutionUI={clear,refresh};
})();
