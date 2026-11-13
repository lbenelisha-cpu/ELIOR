const $=id=>document.getElementById(id);
const panel=$('colmexFinancials');
const add=(tag,text,parent)=>{const el=document.createElement(tag);el.textContent=text;parent.append(el);return el;};
const number=v=>Number.isFinite(v)?v.toLocaleString('he-IL',{maximumFractionDigits:2}):'—';
let current=null,selected='',generation=0,controller;
function link(parent,text,url){const a=add('a',text,parent);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
function render(){
 const host=$('colmexFinancialTable');host.replaceChildren();if(!current)return;
 const rows=current.periods?.[$('colmexFinancialPeriod').value]||[];
 if(!rows.length){add('p','לא נמצאו תקופות מדווחות מתאימות. ניתן לעבור לתצוגה שנתית או לפתוח את המקור.',host);return;}
 const table=add('table','',host);table.className='monitor-table';const head=add('tr','',add('thead','',table)),body=add('tbody','',table);
 for(const title of ['תקופה','הכנסות · מיליון $','שינוי שנתי','רווח נקי · מיליון $','רווח למניה · $','דוח מקורי ותרגום']){const th=add('th',title,head);th.scope='col';}
 for(const row of rows){const tr=add('tr','',body);add('td',row.start+' — '+row.end,tr);add('td',number(row.revenue?.value/1e6),tr);add('td',Number.isFinite(row.revenueGrowthPct)?number(row.revenueGrowthPct)+'%':'—',tr);add('td',number(row.netIncome?.value/1e6),tr);add('td',number(row.eps?.value),tr);
 const cell=add('td','',tr),acc=row.revenue?.accession,cik=String(current.cik||'');
 if(/^\d{1,10}$/.test(cik)&&/^\d{10}-\d{2}-\d{6}$/.test(acc||'')){
 const url='https://www.sec.gov/Archives/edgar/data/'+Number(cik)+'/'+acc.replaceAll('-','')+'/'+acc+'-index.html';
 link(cell,'פתח את הדוח ↗',url);add('br','',cell);link(cell,'פתח בתרגום לעברית ↗','https://translate.google.com/translate?sl=auto&tl=he&u='+encodeURIComponent(url));
 }else add('span','אין קישור לדוח במקור',cell);
 add('small',' · הוגש '+(row.revenue?.filed||'—'),cell);
 }
}
function selection(){return ($('selectedSymbol')?.textContent||'AAPL').trim().toUpperCase();}
function reset(){controller?.abort();generation++;current=null;selected=selection();$('colmexFinancialSymbol').textContent=selected;$('colmexFinancialSource').href='https://www.sec.gov/edgar/browse/?CIK='+encodeURIComponent(selected)+'&owner=exclude';$('colmexFinancialTable').replaceChildren();$('colmexFinancialStatus').textContent='פתח את האזור כדי לטעון את דוחות '+selected;}
async function load(){
 reset();const symbol=selected,run=generation;controller=new AbortController();const requestController=controller;const timeout=setTimeout(()=>requestController.abort(),15000);
 $('colmexFinancialStatus').textContent='טוען דוחות עבור '+symbol+'…';
 try{const response=await fetch('/.netlify/functions/trader-research?symbol='+encodeURIComponent(symbol),{signal:controller.signal,credentials:'omit'});const data=await response.json();if(run!==generation)return;if(!response.ok||data.symbol!==symbol||data.version!=='TRADER_RESEARCH_V1')throw Error('REPORT_UNAVAILABLE');
 const messages={CONFIG_REQUIRED:'מקור הדוחות דורש הגדרת SEC_USER_AGENT בשרת עם כתובת קשר. הדוחות עדיין אינם זמינים כאן.',NOT_COVERED:'לא נמצאו דוחות מתאימים לנכס זה. ייתכן שמדובר בקרן או בנכס שאינו מדווח בפורמט הנתמך.',UNAVAILABLE:'מקור הדוחות אינו זמין כרגע. נסה שוב מאוחר יותר.'};
 if(data.financials?.status!=='OK'){$('colmexFinancialStatus').textContent=messages[data.financials?.status]||messages.UNAVAILABLE;return;}
 current=data.financials.data;$('colmexFinancialStatus').textContent=current.company+' · SEC EDGAR · נבדק '+new Date(data.fetchedAt).toLocaleString('he-IL')+(data.cached?' · עותק שמור':'');render();
 }catch(error){if(run===generation)$('colmexFinancialStatus').textContent='לא ניתן לטעון את הדוחות כרגע. לחץ על רענון כדי לנסות שוב.';}finally{clearTimeout(timeout);}
}
panel.addEventListener('toggle',()=>{if(panel.open&&!current)load();});
$('colmexFinancialRefresh').addEventListener('click',load);$('colmexFinancialPeriod').addEventListener('change',render);
new MutationObserver(()=>{if(selection()!==selected){reset();if(panel.open)load();}}).observe($('selectedSymbol'),{childList:true,characterData:true,subtree:true});reset();
