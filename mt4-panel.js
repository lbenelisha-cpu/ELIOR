(() => {
  if(!['http://127.0.0.1:22351','http://127.0.0.1:22352','http://127.0.0.1:22353'].includes(location.origin))return;
  const el=id=>document.getElementById(id);el('setup').hidden=true;el('account-view').hidden=false;
  let session='',busy=false;
  window.LEVIRequest=async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-ELIOR-Session':session},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const data=await r.json();if(!r.ok)throw Error(data.error||'הבקשה נכשלה');return data;};
  const add=(root,label,value)=>{const p=document.createElement('p');p.textContent=label+': '+String(value??'—');root.append(p);};
  function renderPositions(positions,currency,quotes=[]){
    const root=el('positions');root.replaceChildren();
    if(!Array.isArray(positions)||!positions.length){root.textContent='אין פוזיציות פתוחות';return;}
    const total=positions.reduce((sum,p)=>sum+(Number.isFinite(p.profit)?p.profit:0),0);
    const money=value=>Number.isFinite(value)?new Intl.NumberFormat('he-IL',{style:'currency',currency:currency||'USD',signDisplay:'exceptZero'}).format(value):'—';
    const headline=document.createElement('div');headline.className='positions-summary';
    const count=document.createElement('span');count.textContent=positions.length+' פוזיציות פתוחות';
    const pnl=document.createElement('strong');pnl.className=total<0?'pnl-loss':'pnl-gain';pnl.textContent='רווח / הפסד כולל: '+money(total);headline.append(count,pnl);root.append(headline);
    const scroll=document.createElement('div');scroll.className='positions-scroll';const table=document.createElement('table');table.className='positions-table';table.setAttribute('aria-label','פוזיציות פתוחות');
    const head=document.createElement('thead'),row=document.createElement('tr');
    for(const title of ['מניה','סוג עסקה','כמות בלוטים','רווח / הפסד','מספר עסקה','פעולות']){const cell=document.createElement('th');cell.scope='col';cell.textContent=title;row.append(cell);}head.append(row);table.append(head);
    const body=document.createElement('tbody');const types=['קנייה','מכירה','קנייה מוגבלת','מכירה מוגבלת','קניית סטופ','מכירת סטופ'];
    for(const p of positions){const tr=document.createElement('tr');const values=[p.symbol,types[p.type]||'הוראה ממתינה',Number.isFinite(p.lots)?new Intl.NumberFormat('he-IL',{maximumFractionDigits:8}).format(p.lots):'—',money(p.profit),p.ticket];
      values.forEach((value,i)=>{const td=document.createElement('td');td.textContent=String(value??'—');if(i===0||i===4)td.dir='ltr';if(i===0)td.className='position-symbol';if(i===3)td.className=p.profit<0?'pnl-loss':'pnl-gain';tr.append(td);});
      const actions=document.createElement('td'),group=document.createElement('div');group.className='trade-actions';const quote=quotes.find(q=>q.symbol===p.symbol);
      for(const side of ['buy','sell']){const button=document.createElement('button');button.type='button';button.className='trade-button trade-'+side;button.textContent=side==='buy'?'הכן קנייה':'הכן מכירה';button.setAttribute('aria-label',button.textContent+' '+p.symbol+' עסקה '+p.ticket);button.disabled=!quote||quote.status!=='current'||p.type!==0;button.title=button.disabled?'נדרשים נתונים עדכניים למניה ופוזיציית קנייה פתוחה':'פתיחת טיוטה בלבד — לא נשלחת עסקה';button.onclick=()=>window.dispatchEvent(new CustomEvent('levi-order-draft',{detail:{symbol:p.symbol,side,ticket:p.ticket}}));group.append(button);}actions.append(group);tr.append(actions);body.append(tr);
    }table.append(body);scroll.append(table);root.append(scroll);
    const note=document.createElement('p');note.className='positions-note';note.textContent='הכמות מוצגת בלוטים לפי MT4. רווח / הפסד כולל עמלות וסוואפ שדווחו במחבר. כפתורי הפעולה פותחים טיוטה. מכירה סוגרת את עסקת הקנייה שנבחרה רק לאחר אישור אישי.';root.append(note);
  }
  async function refresh(){
    if(busy)return;busy=true;el('refresh').disabled=true;el('account').replaceChildren();el('positions').textContent='';el('updated').textContent='';el('status').className='';el('status').textContent='בודק חיבור ל־MT4…';
    try{
      if(!session){const r=await fetch('/api/session',{cache:'no-store'});if(!r.ok)throw Error('השירות המקומי אינו זמין');session=(await r.json()).session;}
      let r=await fetch('/api/account',{headers:{'X-ELIOR-Session':session},cache:'no-store',signal:AbortSignal.timeout(35000)});
      if(r.status===401){
        session='';const renewed=await fetch('/api/session',{cache:'no-store',signal:AbortSignal.timeout(10000)});
        if(!renewed.ok)throw Error('השירות המקומי אינו זמין');session=(await renewed.json()).session;
        r=await fetch('/api/account',{headers:{'X-ELIOR-Session':session},cache:'no-store',signal:AbortSignal.timeout(35000)});
      }
      const data=await r.json();if(!r.ok)throw Error(data.error||'החיבור נכשל');
      window.dispatchEvent(new CustomEvent('levi-snapshot',{detail:data})); if(data.testMode){document.querySelector('h1').textContent='בדיקת ממשק בלבד · נתונים מדומים';}const a=data.account||{};el('status').className=data.connected?'connected':'warning';el('status').textContent=data.connected?(data.executionEnabled?'MT4 מחובר · ביצוע לאחר אישור אישי פעיל':'MT4 מחובר · ביצוע כבוי במחבר'):'MT4 נגיש, אך מנותק משרת הברוקר. הנתונים הכספיים אינם זמינים.';
      add(el('account'),'סוג חשבון',a.type==='real'?'לייב':a.type==='demo'?'דמו':a.type||'לא ידוע');add(el('account'),'חשבון',a.login);add(el('account'),'שרת',a.server);
      if(data.connected){add(el('account'),'יתרה',a.balance+' '+a.currency);add(el('account'),'שווי חשבון',a.equity+' '+a.currency);add(el('account'),'רווח/הפסד',a.profit+' '+a.currency);renderPositions(data.positions,a.currency,data.quotes);}else{el('positions').textContent='אין נתונים עדכניים';}
      el('updated').textContent='בדיקה אחרונה: '+new Date(data.receivedAt).toLocaleString('he-IL');
    }catch(e){window.dispatchEvent(new CustomEvent('levi-snapshot-error',{detail:e.message}));el('status').className='warning';el('status').textContent=e.message;}finally{busy=false;el('refresh').disabled=false;}
  }
  el('refresh').onclick=refresh;refresh();setInterval(()=>{refresh();},30000);
})();







