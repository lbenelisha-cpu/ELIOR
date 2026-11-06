/* Public headline translations for display only; no account or trading data. */
(()=>{
 'use strict';
 const VERSION='NEWS_HE_BRIEF_V1',KEY='levi-news-he-brief-v1',DAY=86400000;
 const hosts=new Set(['www.coindesk.com','cointelegraph.com','www.prnewswire.com']);
 const cache=new Map(),inflight=new Map(),observed=new Map(),expanded=new Set(),queue=[];
 let active=0,charges=[],blockedUntil=0;
 const clean=value=>String(value||'').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{
  const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);
  return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';
 }).replace(/&(amp|quot|apos|lt|gt|nbsp);/g,(_,n)=>({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '})[n])
  .replace(/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim();
 const validText=value=>typeof value==='string'&&value.length<=1000&&/[\u05d0-\u05ea]/.test(value)&&!/<[^>]*>/.test(value);
 const current=at=>Number.isFinite(at)&&at>0&&at<=Date.now();
 function prune(){
  charges=charges.filter(r=>current(r?.at)&&Date.now()-r.at<DAY&&Number.isFinite(r.count)&&r.count>0&&r.count<=500);
  for(const [title,row]of cache)if(!current(row.at)||Date.now()-row.at>7*DAY)cache.delete(title);
  while(cache.size>300)cache.delete(cache.keys().next().value);
 }
 function persist(){
  prune();try{localStorage.setItem(KEY,JSON.stringify({version:VERSION,cache:[...cache],charges,blockedUntil}));}catch{}
 }
 try{
  const stored=JSON.parse(localStorage.getItem(KEY)||'null');
  if(stored?.version===VERSION){
   for(const pair of Array.isArray(stored.cache)?stored.cache.slice(-300):[]){
    if(!Array.isArray(pair)||pair.length!==2)continue;
    const [title,row]=pair;if(typeof title==='string'&&title.length<=400&&validText(row?.text)&&current(row.at))cache.set(title,{text:clean(row.text),at:row.at});
   }
   charges=Array.isArray(stored.charges)?stored.charges.slice(-5000):[];
   blockedUntil=Number.isFinite(stored.blockedUntil)?Math.min(stored.blockedUntil,Date.now()+DAY):0;
  }
 }catch{}
 prune();
 function headline(row){
  try{
   const url=new URL(row?.url);
   if(url.protocol!=='https:'||url.username||url.password||url.port||!hosts.has(url.hostname))return null;
   const title=clean(row.title);
   // Translate the whole headline. Never cut off a qualification or negation.
   if(!title||title.length>400||new TextEncoder().encode(title).length>500)return null;
   return title;
  }catch{return null;}
 }
 function pump(){
  while(active<2&&queue.length){const task=queue.shift();active++;task().finally(()=>{active--;pump();});}
 }
 function translate(title){
  prune();
  if(cache.has(title))return Promise.resolve({text:cache.get(title).text});
  if(inflight.has(title))return inflight.get(title);
  const promise=new Promise(resolve=>{
   queue.push(async()=>{
    prune();
    if(blockedUntil>Date.now()||charges.reduce((n,r)=>n+r.count,0)+title.length>5000){resolve({error:'LIMIT'});return;}
    charges.push({at:Date.now(),count:title.length});persist();
    try{
     const url=new URL('https://api.mymemory.translated.net/get');
     url.searchParams.set('q',title);url.searchParams.set('langpair','autodetect|he');
     const response=await fetch(url.href,{credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
     if(!response.ok)throw Error(response.status===429?'LIMIT':'UNAVAILABLE');
     const data=await response.json();
     if(data.quotaFinished||Number(data.responseStatus)===429)throw Error('LIMIT');
     const text=clean(data.responseData?.translatedText);
     if(Number(data.responseStatus)!==200||!validText(text)||text===title)throw Error('UNAVAILABLE');
     cache.set(title,{text,at:Date.now()});persist();resolve({text});
    }catch(error){
     const limited=error.message==='LIMIT';
     if(limited){blockedUntil=Date.now()+DAY;persist();}
     resolve({error:limited?'LIMIT':'UNAVAILABLE'});
    }
   });pump();
  });
  // Keep failed results for this page too: refresh timers must not retry forever.
  inflight.set(title,promise);return promise;
 }
 const add=(tag,text,parent,cls)=>{const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;parent.append(el);return el;};
 function append(parent,row){
  for(const [node,observer]of observed)if(!node.isConnected){observer.disconnect();observed.delete(node);}
  prune();const title=headline(row);if(!title)return null;
  const box=add('div','',parent,'news-brief'),text=add('p','מכין תקציר בעברית…',box,'news-brief-text');
  box.dir='rtl';box.lang='he';
  const note=add('small','',box,'news-brief-note');
  function display(result){
   if(result.text){
    text.textContent=result.text;note.textContent='בקצרה · תרגום אוטומטי של הכותרת';box.dataset.state='ready';
    if(result.text.length>180){
     const open=expanded.has(title);if(!open)box.classList.add('news-brief-collapsed');const button=add('button',open?'צמצם':'הצג את כל התקציר',box,'news-brief-more');button.type='button';button.setAttribute('aria-expanded',String(open));
     button.onclick=()=>{const closed=box.classList.toggle('news-brief-collapsed');if(closed)expanded.delete(title);else expanded.add(title);button.setAttribute('aria-expanded',String(!closed));button.textContent=closed?'הצג את כל התקציר':'צמצם';};
    }
   }else{box.dataset.state='unavailable';text.textContent=result.error==='LIMIT'?'מכסת התרגום הסתיימה זמנית · הכותרת המקורית בהמשך':'התרגום לעברית אינו זמין כרגע · הכותרת המקורית בהמשך';}
  }
  if(/[\u05d0-\u05ea]/.test(title)&&!/[a-z]{3}/i.test(title)){
   text.textContent=title;note.textContent='בקצרה · כותרת המקור';box.dataset.state='ready';return box;
  }
  if(cache.has(title)){display({text:cache.get(title).text});return box;}
  const start=()=>translate(title).then(display);
  // Only visible stories spend translation quota, including inside <details>.
  if(typeof IntersectionObserver==='function'){
   const observer=new IntersectionObserver(entries=>{
    if(!box.isConnected){observer.disconnect();observed.delete(box);return;}
    if(entries.some(e=>e.isIntersecting)){observer.disconnect();observed.delete(box);start();}
   });observed.set(box,observer);observer.observe(box);
  }else start();
  return box;
 }
 window.LEVI_NEWS_SUMMARY=Object.freeze({version:VERSION,append});
})();
