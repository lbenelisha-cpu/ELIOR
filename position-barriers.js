(function(global){
 'use strict';
 const MAX_AGE=120000,policies=['FIXED_TP4_SL1_V1','PROFIT_FLOOR4_TRAIL1PP_STOP1_V1','PROFIT_ACTIVATE5_TRAIL1PP_STOP1_V2','COLMEX_CHANNEL_SHORT_EXIT_V1','FUTURES_SHORT_SETTINGS_V2'];
 const num=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
 const at=v=>typeof v==='number'?v:Date.parse(v);
 const fmt=v=>v===null?'—':v.toLocaleString('en-US',{maximumSignificantDigits:10});
 function levels(position,{side=position?.side||'LONG',observedAt,unavailable=false,now=Date.now()}={}){
  const p=position;if(!p||!policies.includes(p.exitPolicy)||!['LONG','SHORT'].includes(side)||!num(p.qty)||!num(p.entryPrice))return null;
  const entry=num(p.entryPrice),direction=side==='SHORT'?-1:1,entryAt=at(p.entryAt);
  if(!Number.isFinite(entryAt)||entryAt<=0||entryAt>now)return null;
  const stop=num(p.effectiveStopPrice??p.stopPrice),rawTarget=num(p.targetPrice),target=rawTarget&&direction*(rawTarget-entry)>0?rawTarget:null;
  const activation=p.exitPolicy==='FIXED_TP4_SL1_V1'?null:num(p.activationPrice);
  const priceAt=at(p.positionQuoteAt??p.priceAt??p.lastQuoteAt),checkedAt=at(observedAt??priceAt);
  const fresh=t=>Number.isFinite(t)&&t>0&&t<=now&&now-t<=MAX_AGE;
  const stale=unavailable||!fresh(priceAt)||!fresh(checkedAt);
  const price=num(p.currentPrice??p.price??p.lastBid),armed=p.armed===true||p.profitFloorArmed===true||p.trailingActive===true;
  const lines=[{kind:'entry',price:entry,label:'מחיר כניסה',color:'#b5cbe5'},
   {kind:'stop',price:stop,label:armed?'סטופ נגרר נוכחי':'סטופ נוכחי',color:'#ff8494'},
   {kind:'activation',price:activation,label:'הפעלת הגנת רווח',color:'#ffd166'},
   {kind:'target',price:target,label:'יעד רווח TP',color:'#64e1ae'}].filter(x=>x.price!==null).map(x=>({...x,pct:direction*(x.price/entry-1)*100}));
  return {side,entry,entryAt,stop,target,activation,price,priceAt,checkedAt,stale,armed,lines,missing:!stop||!target||(p.exitPolicy!=='FIXED_TP4_SL1_V1'&&!activation)};
 }
 function fromSnapshot(snapshot,symbol,now=Date.now()){
  if(!snapshot)return null;let p,side,observedAt,unavailable=!!snapshot.error;
  if(snapshot.venue==='COLMEX'){
   const d=snapshot.status;if(d?.live!==true)return null;p=d.positions?.find(x=>x.symbol===symbol);side=p?.side||'LONG';observedAt=at(d.lastBrokerSnapshotAt);
   unavailable ||= !!d.pendingActions?.some(x=>x.symbol===symbol&&!x.quarantined);
  }else if(snapshot.venue==='BINANCE_FUTURES'){
   const f=snapshot.shortTrading;if(snapshot.mode!=='live')return null;p=f?.positions?.find(x=>x.symbol===symbol);side='SHORT';observedAt=at(f?.checkedAt);unavailable ||= !f?.account||!!f?.pending||!!f?.halt;
  }else{
   if(snapshot.mode!=='live')return null;
   const a=snapshot.agent?.agents?.find(x=>x.symbol===symbol),wallet=snapshot.account?.balances?.find(x=>x.asset+'USDT'===symbol);
   if(a?.position!=='LONG'||a.accountOnly||!num(wallet?.qty)||!num(a.strategy?.qty)||Math.abs(Number(wallet.qty)-Number(a.strategy.qty))>Math.max(1e-8,Number(a.strategy.qty)*1e-6))return null;
   p=a.strategy;side='LONG';observedAt=at(snapshot.account.updatedAt);unavailable ||= a.staleData||snapshot.account.connected!==true||!!snapshot.account.error;
  }
  const r=levels(p,{side,observedAt,unavailable,now});return r?{...r,symbol,venue:snapshot.venue||'BINANCE_SPOT'}:null;
 }
 function render(host,model){
  if(!host)return;host.replaceChildren();host.classList.add('position-barriers');
  if(!model){host.hidden=true;return;}host.hidden=false;
  const doc=host.ownerDocument||document,el=(tag,text)=>{const e=doc.createElement(tag);if(text)e.textContent=text;return e;};
  const time=Number.isFinite(model.priceAt)?new Date(model.priceAt).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem',hour12:false}):'לא ידוע';
  const title=el('strong','חסמי העסקה · '+(model.symbol||'')+' · '+model.side),status=el('p',(model.stale?'נתונים ישנים / לא מאומתים · ':'נתוני שרת · ')+'עדכון מחיר: '+time);status.className=model.stale?'barriers-stale':'barriers-fresh';
  const ns='http://www.w3.org/2000/svg',svg=doc.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 320 180');svg.setAttribute('role','img');svg.setAttribute('aria-label','מפת חסמים '+model.side+' · '+model.lines.map(x=>x.label+' '+fmt(x.price)).join(' · '));
  const prices=model.lines.map(x=>x.price);if(model.price)prices.push(model.price);const min=Math.min(...prices),max=Math.max(...prices),pad=(max-min)*.12||min*.01,lo=min-pad,hi=max+pad,y=p=>160-(p-lo)/(hi-lo)*140;
  function draw(tag,attrs,text){const e=doc.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));if(text)e.textContent=text;svg.append(e);}
  for(const line of model.lines){draw('line',{x1:8,x2:220,y1:y(line.price),y2:y(line.price),stroke:line.color,'stroke-width':2,'stroke-dasharray':line.kind==='entry'?'2 3':'7 4','data-barrier':line.kind});draw('text',{x:225,y:y(line.price)+4,fill:line.color,'font-size':10},fmt(line.price));}
  if(model.price){draw('circle',{cx:180,cy:y(model.price),r:5,fill:model.stale?'#94a3b8':'#fff'});draw('text',{x:8,y:176,fill:'#b6cbdc','font-size':10},'מחיר שנצפה: '+fmt(model.price));}
  const list=el('div');list.className='barriers-legend';for(const line of model.lines){const row=el('div'),label=el('span',line.label),value=el('bdi',fmt(line.price)+' · '+(line.pct>=0?'+':'')+line.pct.toFixed(2)+'%');row.style.setProperty('--barrier-color',line.color);row.append(label,value);list.append(row);}
  const note=el('small',model.missing?'חלק מהרמות חסרות בדיווח השרת; לא חושבו ערכים חלופיים.':'מפת מחירים, לא גרף זמן · אחוזים ממחיר הכניסה בכיוון העסקה · לפני עמלות.');
  host.append(title,status,svg,list,note);
 }
 global.LEVI_POSITION_BARRIERS={levels,fromSnapshot,render,MAX_AGE};
})(globalThis);
