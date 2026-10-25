import {createPaper,normalizeBars,runPaperCycle,paperValue,backtestDaily,RULES,restorePaperState} from './lib/meitav-paper.mjs';
import {evaluateWyckoff as evaluateWaveStrategy} from './lib/wyckoff-strategy.mjs';
import {compareScenarios} from './lib/meitav-experiments.mjs';
const $=s=>document.querySelector(s),key='levi.meitav.paper.v1',fmt=n=>Number(n).toLocaleString('he-IL',{maximumFractionDigits:2}),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let research=null;
let comparison=null;
let state={paper:createPaper(),markets:[]},selected=null;
try{const s=JSON.parse(localStorage.getItem(key));if(s)state=restorePaperState(s);}catch{$('#status').textContent='לא ניתן לקרוא תיק שמור; התחל תיק חדש';}
$('#currency').value=state.paper.currency;$('#initial').value=state.paper.initial;$('#fee').value=state.paper.feePct;
function save(){localStorage.setItem(key,JSON.stringify(state));}
function render(){
 research=null;$('#researchPanel').hidden=true;
 const p=state.paper,prices=Object.fromEntries(state.markets.map(m=>[m.symbol,m.bars.at(-1).close])),value=paperValue(p,prices),held=Object.keys(p.positions).length;
 $('#summary').innerHTML=[['שווי הדמיה',fmt(value)+' '+p.currency],['מזומן',fmt(p.cash)+' '+p.currency],['רווח / הפסד',fmt(value-p.initial)+' '+p.currency],['פוזיציות',held+'/6'],['מזומן למקום פנוי',held<6?fmt(p.cash/(6-held))+' '+p.currency:'—'],['מכירות',p.journal.filter(j=>j.type==='SELL').length]].map(([k,v])=>`<article><span>${k}</span><strong>${v}</strong></article>`).join('');
 $('#markets').innerHTML=state.markets.map(m=>{const s=evaluateWaveStrategy(m.bars,RULES),held=!!p.positions[m.symbol];return `<tr data-symbol="${esc(m.symbol)}" class="${held?'active-position '+(s.direction==='DOWN'?'active-down':'active-up'):''}"><td>${esc(m.symbol)}</td><td>${fmt(s.price)}</td><td>${esc(s.phase)}</td><td>${held?'פוזיציה פעילה':s.buyConfirmed?'מתאים לקנייה':'ממתין'}</td></tr>`;}).join('');
 $('#markets').querySelectorAll('tr').forEach(r=>r.onclick=()=>{selected=r.dataset.symbol;draw();});
 $('#positions').innerHTML=Object.values(p.positions).map(x=>{const price=prices[x.symbol]||x.lastPrice;return `<tr><td>${esc(x.symbol)}</td><td>${fmt(x.qty)}</td><td>${fmt(x.entryPrice)}</td><td>${fmt(price)}</td><td>${Number.isFinite(x.targetPrice)?fmt(x.targetPrice):"נדרש בירור"}</td><td>${Number.isFinite(x.stopPrice)?fmt(x.stopPrice):"—"}</td><td>${fmt(x.qty*price-x.cost)} ${p.currency}</td></tr>`;}).join('')||'<tr><td colspan="7">אין פוזיציות הדמיה</td></tr>';
 $('#journal').innerHTML=p.journal.slice(0,30).map(j=>`<div class="action-card"><b>${j.type==='BUY'?'קנייה':'מכירה'} · ${esc(j.symbol)}</b><span>${esc(j.date)} · ${fmt(j.amount)} ${p.currency}</span><small>${esc(j.reason)}${j.pnl!==undefined?' · רווח / הפסד '+fmt(j.pnl):''}</small></div>`).join('')||'טרם בוצעו פעולות הדמיה';
 if(!selected)selected=state.markets[0]?.symbol;draw();
}
function draw(){$('#experiments').hidden=true;comparison=null;const m=state.markets.find(x=>x.symbol===selected);if(!m)return;const s=evaluateWaveStrategy(m.bars,RULES),rows=m.bars.slice(-180),all=m.bars;
 $('#chartTitle').textContent=m.symbol;$('#meta').textContent=`${m.source} · סגירה אחרונה ${m.bars.at(-1).date} · ${m.currency} · קו כחול: מחיר; קו צהוב: MA200`;
 const mas=all.map((_,i)=>i>=199?all.slice(i-199,i+1).reduce((n,b)=>n+b.close,0)/200:null).slice(-rows.length),vals=[...rows.map(b=>b.close),...mas.filter(v=>v!==null)],lo=Math.min(...vals)*.98,hi=Math.max(...vals)*1.02;
 const point=(v,i)=>`${40+i/(rows.length-1)*810},${315-(v-lo)/(hi-lo)*270}`;
 $('#chart').innerHTML=`<polyline fill="none" stroke="#65c2ff" stroke-width="2" points="${rows.map((b,i)=>point(b.close,i)).join(' ')}"/><polyline fill="none" stroke="#ffd36a" stroke-width="2" points="${mas.map((v,i)=>v===null?'':point(v,i)).filter(Boolean).join(' ')}"/><text x="40" y="350" fill="#aaa">${rows[0].date}</text><text x="720" y="350" fill="#aaa">${rows.at(-1).date}</text>`;
 $('#technical').innerHTML=[['שלב',s.phase],['שפל ראשון',s.firstLow?fmt(s.firstLow.price):'—'],['יעד מכירה',s.targetPrice?fmt(s.targetPrice):'—'],['תנאי קנייה',s.buyConfirmed?'מתקיימים':'לא מתקיימים']].map(([k,v])=>`<div><span>${k}</span><strong>${v}</strong></div>`).join('');
 $('#backtest').textContent='';
}
function add(m){if(m.currency!==state.paper.currency)throw Error('מטבע המניה שונה ממטבע התיק. אין המרת מטבע אוטומטית.');m.bars=normalizeBars(m.bars);const old=state.markets.find(x=>x.symbol===m.symbol);if(old&&old.bars.at(-1).date>m.bars.at(-1).date)throw Error('הנתונים ישנים מהסדרה הקיימת');state.markets=state.markets.filter(x=>x.symbol!==m.symbol);state.markets.push(m);selected=m.symbol;save();render();}
async function action(fn){try{await fn();}catch(e){$('#status').textContent=e.message;}}
$('#load').onclick=()=>action(async()=>{const symbol=$('#symbol').value.trim().toUpperCase();$('#load').disabled=true;$('#status').textContent='טוען נרות יומיים…';try{const r=await fetch('/.netlify/functions/meitav-market?symbol='+encodeURIComponent(symbol)+'&history='+$('#history').value,{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error||'שגיאת נתונים');add(d);$('#status').textContent='נתונים נטענו; תיק הדמיה בלבד';}finally{$('#load').disabled=false;}});
$('#csv').onchange=()=>action(async()=>{const file=$('#csv').files[0];if(!file)return;if(file.size>2000000)throw Error('קובץ גדול מדי');const raw=await file.text();if(raw.includes('"'))throw Error('ייבא CSV פשוט ללא מרכאות: Date,Open,High,Low,Close');const text=raw.replace(/^\uFEFF/,''),lines=text.trim().split(/\r?\n/),sep=lines[0].includes(';')?';':',',head=lines.shift().split(sep).map(s=>s.trim().toLowerCase());const di=head.findIndex(x=>['date','datetime'].includes(x)),ci=head.indexOf('close');const oi=head.indexOf('open'),hi=head.indexOf('high'),li=head.indexOf('low');if([di,ci,oi,hi,li].some(i=>i<0))throw Error('כותרות CSV נדרשות: Date,Open,High,Low,Close');const symbol=$('#symbol').value.trim().toUpperCase();if(!/^[A-Z][A-Z0-9.\-]{0,11}$/.test(symbol))throw Error('סימול לא תקין');const bars=lines.filter(Boolean).map(l=>{const cells=l.split(sep);return {date:cells[di].trim(),open:Number(cells[oi]),high:Number(cells[hi]),low:Number(cells[li]),close:Number(cells[ci])};});const today=new Date().toISOString().slice(0,10);if(bars.some(b=>b.date>=today))throw Error('ייבא רק נרות סגורים מתאריכים לפני היום');add({symbol,currency:state.paper.currency,bars,source:'CSV שהוזן ידנית'});$('#status').textContent='CSV נטען';});
$('#cycle').onclick=()=>action(()=>{runPaperCycle(state.paper,state.markets);save();render();$('#status').textContent='מחזור הדמיה הושלם על סגירות יומיות';});
$('#test').onclick=()=>action(()=>{const m=state.markets.find(m=>m.symbol===selected);if(!m)throw Error('טען מניה תחילה');const r=backtestDaily(m.bars,state.paper.feePct);$('#backtest').textContent=`בדיקה היסטורית · מודל: ${fmt(r.returnPct)}% · קנייה והחזקה: ${fmt(r.holdReturnPct)}% · ירידה מרבית: ${fmt(r.maxDrawdown)}% · פעולות: ${r.trades}. ${r.limitation}`;});
$('#reset').onclick=()=>action(()=>{if(!confirm('ליצור תיק הדמיה חדש ולמחוק את הנתונים המקומיים הקודמים?'))return;state={paper:createPaper(Number($('#initial').value),$('#currency').value,Number($('#fee').value)),markets:[]};selected=null;$('#chart').innerHTML='';$('#chartTitle').textContent='בחר מניה';$('#meta').textContent='';$('#technical').innerHTML='';$('#backtest').textContent='';save();render();});
$('#export').onclick=()=>{const u=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download='meitav-paper-backup.json';a.click();URL.revokeObjectURL(u);};
render();

function renderComparison(){
 const r=comparison;if(!r)return;const sample=r.results[0],chosen=r.results.find(x=>x.scenario.id===r.selectedId),base=r.results.find(x=>x.scenario.id==='base');
 $('#experimentMeta').textContent=`${r.symbol} · עמלה ${fmt(r.feePct)}% לכל פעולה · השוואה: ${sample.train.startDate} עד ${sample.train.endDate} (${r.trainDays} ימים) · בדיקה נפרדת: ${sample.validation.startDate} עד ${sample.validation.endDate} (${r.validationDays} ימים)`;
 $('#experimentRows').innerHTML=r.results.map(x=>{const c=x.scenario;return `<tr class="${c.id===r.selectedId?'chosen':''}"><td>${esc(c.name)}${c.id===r.selectedId?' · נבחר בתקופה הראשונה':''}</td><td>${c.min}%–8%</td><td>${c.stop}%</td><td>${c.exit==='wave'?'נסיגה '+fmt(c.retrace*100)+'% מהגל':c.exit==='ma'?'MA200':'ללא'}</td><td>${fmt(x.train.returnPct)}%</td><td>${fmt(x.validation.returnPct)}%</td><td>${fmt(x.validation.maxDrawdown)}%</td><td>${x.validation.actions}</td></tr>`;}).join('');
 const v=chosen.validation,hold=v.holdReturnPct;
 $('#experimentVerdict').textContent=`התרחיש שנבחר בתקופה הראשונה: ${chosen.scenario.name}. בבדיקה הנפרדת: ${fmt(v.returnPct)}%, מול ${fmt(base.validation.returnPct)}% בכללי הגלים הקודמים ו־${fmt(hold)}% בקנייה והחזקה. ${v.returnPct>base.validation.returnPct?'הוא שיפר את התשואה ביחס לכללי הגלים הקודמים בבדיקה הזאת.':'הוא לא שיפר את התשואה ביחס לכללי הגלים הקודמים בבדיקה הזאת.'} ${v.returnPct>hold?'הוא גם עבר את הקנייה וההחזקה בבדיקה הזאת.':'הוא לא עבר את הקנייה וההחזקה בבדיקה הזאת.'} נדרשות בדיקות במניות ובתקופות נוספות; אין החלפה אוטומטית של החוקים.`;
 $('#experimentChoice').innerHTML=r.results.map(x=>`<option value="${x.scenario.id}">${esc(x.scenario.name)}</option>`).join('');$('#experimentChoice').value=r.selectedId;drawExperiment();
}
function drawExperiment(){
 if(!comparison)return;const x=comparison.results.find(x=>x.scenario.id===$('#experimentChoice').value),base=comparison.results.find(x=>x.scenario.id==='base'),v=x.validation,m=state.markets.find(m=>m.symbol===comparison.symbol);
 const prices=new Map(m.bars.map(b=>[b.date,b.close])),start=prices.get(v.startDate),hold=v.curve.map(b=>({date:b.date,value:10000/(start*(1+comparison.feePct/100))*prices.get(b.date)})),series=[v.curve,base.validation.curve,hold],values=series.flatMap(a=>a.map(b=>b.value)),low=Math.min(...values)*.98,high=Math.max(...values)*1.02;
 const points=a=>a.map((b,i)=>`${55+i/(a.length-1)*790},${315-(b.value-low)/(high-low)*270}`).join(' ');
 $('#experimentChart').innerHTML=series.map((a,i)=>`<polyline fill="none" stroke="${['#65c2ff','#ffd36a','#65e09a'][i]}" stroke-width="2" points="${points(a)}"/>`).join('')+`<text x="5" y="45" fill="#aaa">${fmt(high)}</text><text x="5" y="315" fill="#aaa">${fmt(low)}</text><text x="55" y="350" fill="#aaa">${v.startDate}</text><text x="710" y="350" fill="#aaa">${v.endDate}</text>`;
 $('#experimentDetails').textContent=`${x.scenario.name} · עסקאות סגורות: ${v.closedTrades} · שיעור עסקאות ברווח: ${v.winRate===null?'אין עסקאות סגורות':fmt(v.winRate)+'%'} · עמלות: ${fmt(v.fees)} ${state.paper.currency} · פוזיציה פתוחה בסיום: ${v.openPosition?'כן':'לא'}`;
 $('#experimentJournal').innerHTML=v.journal.slice(-30).reverse().map(j=>`<tr><td>${j.signalDate}</td><td>${j.date}</td><td>${j.type==='BUY'?'קנייה':'מכירה'}</td><td>${fmt(j.price)}</td><td>${esc(j.reason)}</td><td>${j.pnl===undefined?'—':fmt(j.pnl)}</td></tr>`).join('')||'<tr><td colspan="6">אין פעולות בתקופה זו</td></tr>';
}
$('#experimentChoice').onchange=drawExperiment;
$('#compare').onclick=()=>action(async()=>{
 const m=state.markets.find(m=>m.symbol===selected);if(!m)throw Error('בחר מניה שנטענה לפני ההשוואה');$('#compare').disabled=true;$('#status').textContent='משווה תשעה שילובי תנאים…';
 try{await new Promise(resolve=>setTimeout(resolve,0));comparison={...compareScenarios(m.bars,state.paper.feePct),symbol:m.symbol};$('#experiments').hidden=false;renderComparison();$('#status').textContent='השוואת התנאים הושלמה; תיק ההדמיה לא השתנה';$('#experiments').scrollIntoView({behavior:'smooth',block:'start'});}finally{$('#compare').disabled=false;}
});

function renderResearch(){
 const r=research;if(!r)return;const chosen=r.results[0],a=chosen.summary[1],b=chosen.summary[2];
 $('#researchMeta').textContent=`מניות: ${r.symbols.join(', ')} · עמלה ${fmt(r.feePct)}% · עלות ביצוע ${fmt(r.slippagePct)}% לכל צד. `+r.periods.map(p=>`${p.name}: ${p.startDate} עד ${p.endDate}`).join(' · ');
 $('#researchRows').innerHTML=r.results.map(x=>{const [t,a,b]=x.summary;return `<tr class="${x.method.id===r.selectedId?'chosen':''}"><td>${esc(x.method.name)}${x.method.id===r.selectedId?' · נבחרה':''}</td><td>${esc(x.method.rule)}</td><td>${fmt(t.meanReturn)}%</td><td>${fmt(x.score)}</td><td>${fmt(a.meanReturn)}%</td><td>${fmt(a.meanDrawdown)}%</td><td>${fmt(b.meanReturn)}%</td><td>${fmt(b.meanDrawdown)}%</td><td>${b.beatingAssets}/${r.symbols.length}</td></tr>`;}).join('');
 $('#researchVerdict').textContent=`השיטה שנבחרה בחלק הראשון: ${chosen.method.name}. בבדיקה א׳ ממוצע התשואה ${fmt(a.meanReturn)}% מול ${fmt(a.meanHold)}% בהחזקה; בבדיקה ב׳ ${fmt(b.meanReturn)}% מול ${fmt(b.meanHold)}%. ירידת ההחזקה הממוצעת: א׳ ${fmt(a.meanHoldDrawdown)}%, ב׳ ${fmt(b.meanHoldDrawdown)}%. ${a.meanReturn>a.meanHold&&b.meanReturn>b.meanHold?'היא עברה בממוצע את ההחזקה בשתי הבדיקות ההיסטוריות.':'לא הוכח יתרון תשואה בממוצע מול החזקה בשתי הבדיקות.'} זו תוצאה על הרשימה שהוזנה, ללא הבטחה ליתרון בעתיד.`;
 $('#researchMethod').innerHTML=r.results.map(x=>`<option value="${x.method.id}">${esc(x.method.name)}</option>`).join('');$('#researchMethod').value=r.selectedId;
 $('#researchAsset').innerHTML=r.symbols.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');$('#researchPeriod').value='2';drawResearch();
}
function drawResearch(){
 if(!research)return;const x=research.results.find(x=>x.method.id===$('#researchMethod').value),asset=x.assets.find(x=>x.symbol===$('#researchAsset').value),n=Number($('#researchPeriod').value),v=asset.periods[n],market=research.datasets.find(m=>m.symbol===asset.symbol),bars=market.bars.filter(b=>b.date>=v.startDate&&b.date<=v.endDate);
 $('#researchAssets').innerHTML=x.assets.map(m=>{const a=m.periods[1],b=m.periods[2];return `<tr><td>${esc(m.symbol)}</td><td>${fmt(a.returnPct)}%</td><td>${fmt(a.holdReturnPct)}%</td><td>${fmt(a.maxDrawdown)}%</td><td>${fmt(b.returnPct)}%</td><td>${fmt(b.holdReturnPct)}%</td><td>${fmt(b.maxDrawdown)}%</td></tr>`;}).join('');
 $('#researchDetails').textContent=`${asset.symbol} · ${x.method.name} · ${research.periods[n].name} · ${v.startDate} עד ${v.endDate} · ${v.days} ימים · תשואה ${fmt(v.returnPct)}% · החזקה ${fmt(v.holdReturnPct)}% · ירידה מרבית ${fmt(v.maxDrawdown)}% · ${v.actions} פעולות · חשיפה ${fmt(v.exposurePct)}% מהימים · עמלות ${fmt(v.fees)} ${research.currency} · פוזיציה פתוחה בסיום: ${v.openPosition?'כן':'לא'}`;
 function plot(target,series,colors,marks=[]){
  const vals=series.flat(),lo=Math.min(...vals)*.98,hi=Math.max(...vals)*1.02,size=series[0].length,px=i=>55+i/(size-1)*790,py=v=>315-(v-lo)/(hi-lo)*270;
  let svg=series.map((a,i)=>`<polyline fill="none" stroke="${colors[i]}" stroke-width="2" points="${a.map((v,j)=>`${px(j)},${py(v)}`).join(' ')}"/>`).join('');
  for(const j of marks){const i=bars.findIndex(b=>b.date===j.date);if(i<0)continue;const color=j.type==='BUY'?'#75ff9a':'#ff6464';svg+=`<circle cx="${px(i)}" cy="${py(bars[i].close)}" r="5" fill="${color}" stroke="#07111d"><title>${esc((j.type==='BUY'?'קנייה':'מכירה')+' · אות '+j.signalDate+' · ביצוע '+j.date+' · מחיר ביצוע '+fmt(j.price)+(j.reason?' · '+j.reason:''))}</title></circle>`;}
  svg+=`<text x="5" y="35" fill="#aaa">${fmt(hi)}</text><text x="5" y="315" fill="#aaa">${fmt(lo)}</text><text x="55" y="350" fill="#aaa">${v.startDate}</text><text x="710" y="350" fill="#aaa">${v.endDate}</text>`;$(target).innerHTML=svg;
 }
 plot('#researchPriceChart',[bars.map(b=>b.close)],['#65c2ff'],v.journal);plot('#researchEquityChart',[v.curve.map(b=>b.value),v.curve.map(b=>b.hold)],['#65c2ff','#65e09a']);
}
for(const id of ['#researchMethod','#researchAsset','#researchPeriod'])$(id).onchange=drawResearch;
$('#research').onclick=()=>action(async()=>{
 for(const id of ['#research','#load','#csv','#reset','#cycle'])$(id).disabled=true;$('#status').textContent='משווה שיטות על ההיסטוריה שנטענה…';
 try{await new Promise(resolve=>setTimeout(resolve,0));research=await runResearchWorker(state.markets,{feePct:state.paper.feePct,slippagePct:Number($('#slippage').value)});$('#researchPanel').hidden=false;renderResearch();$('#researchPanel').scrollIntoView({behavior:'smooth',block:'start'});$('#status').textContent='מחקר השיטות הושלם; חוקי המסחר לא השתנו';}finally{for(const id of ['#research','#load','#csv','#reset','#cycle'])$(id).disabled=false;}
});
$('#researchExport').onclick=()=>{if(!research)return;const u=URL.createObjectURL(new Blob([JSON.stringify(research,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download='meitav-method-research.json';a.click();URL.revokeObjectURL(u);};

function runResearchWorker(markets,options){
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./meitav-research-worker.mjs',import.meta.url),{type:'module'});
  worker.onmessage=event=>{worker.terminate();if(event.data.error)reject(Error(event.data.error));else resolve(event.data.result);};
  worker.onerror=()=>{worker.terminate();reject(Error('לא ניתן להריץ את מנוע המחקר. רענן את הדף לאחר הפריסה.'));};
  worker.postMessage({markets,options});
 });
}
