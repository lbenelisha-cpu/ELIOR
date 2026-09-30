(() => {
  if(!['http://127.0.0.1:22351','http://127.0.0.1:22352'].includes(location.origin))return;
  const el=id=>document.getElementById(id);el('setup').hidden=true;el('account-view').hidden=false;
  let session='',busy=false;
  const add=(root,label,value)=>{const p=document.createElement('p');p.textContent=label+': '+String(value??'—');root.append(p);};
  async function refresh(){
    if(busy)return;busy=true;el('refresh').disabled=true;el('account').replaceChildren();el('positions').textContent='';el('updated').textContent='';el('status').className='';el('status').textContent='בודק חיבור ל־MT4…';
    try{
      if(!session){const r=await fetch('/api/session',{cache:'no-store'});if(!r.ok)throw Error('השירות המקומי אינו זמין');session=(await r.json()).session;}
      const r=await fetch('/api/account',{headers:{'X-ELIOR-Session':session},cache:'no-store',signal:AbortSignal.timeout(35000)});const data=await r.json();if(!r.ok)throw Error(data.error||'החיבור נכשל');
      const a=data.account||{};el('status').className=data.connected?'connected':'warning';el('status').textContent=data.connected?'MT4 מחובר לשרת הברוקר · צפייה בלבד':'MT4 נגיש, אך מנותק משרת הברוקר. הנתונים הכספיים אינם זמינים.';
      add(el('account'),'סוג חשבון',a.type==='real'?'לייב':a.type==='demo'?'דמו':a.type||'לא ידוע');add(el('account'),'חשבון',a.login);add(el('account'),'שרת',a.server);
      if(data.connected){add(el('account'),'יתרה',a.balance+' '+a.currency);add(el('account'),'שווי חשבון',a.equity+' '+a.currency);add(el('account'),'רווח/הפסד',a.profit+' '+a.currency);el('positions').textContent=JSON.stringify(data.positions,null,2);}else{el('positions').textContent='אין נתונים עדכניים';}
      el('updated').textContent='בדיקה אחרונה: '+new Date(data.receivedAt).toLocaleString('he-IL');
    }catch(e){el('status').className='warning';el('status').textContent=e.message;}finally{busy=false;el('refresh').disabled=false;}
  }
  el('refresh').onclick=refresh;refresh();setInterval(()=>{if(!document.hidden)refresh();},30000);
})();



