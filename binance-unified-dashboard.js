/* Presentation only: reuse the existing chart, account updates and confirmation dialogs. */
(()=>{
 const $=id=>document.getElementById(id),chart=$('chartSection'),overview=document.querySelector('.overview');
 if(!chart||!overview)return;
 document.body.classList.add('unified-dashboard');
 const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
 function fold(nodes,title,cls=''){
  nodes=nodes.filter(Boolean);if(!nodes.length)return null;
  const detail=make('details',null,'unified-details '+cls),summary=make('summary',title);
  nodes[0].before(detail);detail.append(summary,...nodes);return detail;
 }
 // Keep account and protection warnings visible above the selected instrument.
 const metrics=overview.querySelector('.overview-metrics');
 metrics.after(chart);chart.classList.add('app-view','trade-view','scans-view');chart.open=true;
 const body=chart.querySelector('.fold-body'),head=chart.querySelector('.selected-asset-head'),actions=chart.querySelector('.manual-trade-actions');
 const nav=make('section',null,'unified-assets');nav.setAttribute('aria-label','בחירת נכס למסחר');
 const search=make('input');search.type='search';search.placeholder='חיפוש נכס · BTC, ETH…';search.setAttribute('aria-label','חיפוש ברשימת הנכסים');search.autocomplete='off';
 const strip=make('div',null,'unified-asset-strip');strip.setAttribute('role','group');strip.setAttribute('aria-label','מעבר בין נכסים');
 const empty=make('small','ממתין לרשימת הנכסים');empty.setAttribute('role','status');
 nav.append(search,strip,empty);head.before(nav);
 const market=make('select');market.setAttribute('aria-label','מסלול הפוזיציה המוצג');market.className='unified-market';
 for(const [value,label] of [['SPOT','LONG · Spot'],['FUTURES','SHORT · Futures']]){const option=make('option',label);option.value=value;market.append(option);}head.append(market);
 market.addEventListener('change',()=>window.dispatchEvent(new CustomEvent('levi-chart-market',{detail:market.value})));
 head.after(actions);
 const terminal=$('chartTerminal');actions.after(terminal);
 const note=make('p','גרף מחירי Spot · פעולות SHORT מבוצעות בחשבון Futures. רמות מחוץ לטווח מופיעות בכרטיסי המחירים.','unified-source');terminal.before(note);
 // The price cards and candles are the single main view. Expanded diagnostics
 // retain all original DOM IDs, live subscriptions, and copy-to-TradingView controls.
 const details=make('details',null,'unified-details unified-analysis');details.append(make('summary','ניתוח הנכס · הגנות, אינדיקטורים וכלי גרף'));
 const keep=new Set([nav,head,actions,terminal,note]);
 for(const node of [...body.children])if(!keep.has(node))details.append(node);
 body.append(details);
 const connection=make('div',null,'unified-connection');connection.append($('manualConnectBtn'),$('manualForgetBtn'));details.append(connection);
 fold([...metrics.children].slice(4),'תוצאות המסחר היום','unified-daily app-view trade-view portfolio-view');
 // Integrate existing live account widgets into the trading workspace itself.
 // Move the original nodes so their subscriptions and controls remain intact.
 const analytics=document.querySelector('.terminal-analytics');
 if(analytics){
  analytics.classList.add('unified-account-context');
  analytics.classList.remove('app-view','trade-view','portfolio-view');
  analytics.querySelectorAll('.app-view').forEach(node=>node.classList.remove('app-view','trade-view','portfolio-view'));
  analytics.hidden=false;
  body.insertBefore(analytics,details);
 }
 fold([$('terminalLedgers')],'החזקות ויציאות אחרונות','app-view trade-view portfolio-view');
 for(const [id,title,classes] of [
  ['futuresPositionsPanel','חשבון Futures · פוזיציות SHORT והגנות','app-view trade-view portfolio-view'],
  ['pocLiveMonitor','מעקב מסחר LIVE','app-view trade-view portfolio-view pnl-view'],
  ['marketAttentionPanel','איתותים ותצפיתנים','app-view trade-view scans-view'],
  ['maDecisionJournal','יומן השוואת החלטות','app-view trade-view portfolio-view']
 ])fold([$(id)],title,classes);
 $('overviewTitle').textContent='מרכז המסחר שלך';
 const subtitle=overview.querySelector('.overview-sub');if(subtitle)subtitle.textContent='בחר נכס · עקוב אחר הגרף וההגנות · פעל מאותו מסך';
 const buy=$('manualBuyBtn'),sell=$('manualSellBtn');if(buy)buy.textContent='קנייה · LONG Spot';if(sell)sell.textContent='מכירה · LONG Spot';
 let snapshot=window.LEVI_DASHBOARD_SNAPSHOT||null,key='';
 function render(){
  const selected=$('chartSymbol')?.textContent?.trim(),query=search.value.trim().toUpperCase().replace(/[\s/\-]/g,'');
  const ctx=window.LEVI_MANUAL_TRADES?.context?.()||{};
  const agents=snapshot?.agent?.agents||[];
  const rows=agents.filter(a=>/^[A-Z0-9]+USDT$/.test(a.symbol)).map(a=>({symbol:a.symbol,long:a.position==='LONG',short:!!ctx.futures?.positions?.some(p=>p.symbol===a.symbol)}));
  rows.sort((a,b)=>Number(b.long||b.short)-Number(a.long||a.short)||a.symbol.localeCompare(b.symbol));
  const next=JSON.stringify([rows,selected,query,snapshot?.error]);if(next===key)return;key=next;
  strip.replaceChildren();let count=0;
  for(const row of rows){
   if(query&&!row.symbol.includes(query))continue;
   const button=make('button',row.symbol+(row.long?' · LONG':'')+(row.short?' · SHORT':''),'unified-asset');button.type='button';button.dataset.symbol=row.symbol;button.setAttribute('aria-pressed',String(row.symbol===selected));
   button.addEventListener('click',()=>{market.value=row.short&&!row.long?'FUTURES':'SPOT';window.dispatchEvent(new CustomEvent('levi-chart-market',{detail:market.value}));window.dispatchEvent(new CustomEvent('levi-dashboard-select',{detail:row.symbol}));});
   strip.append(button);count++;
  }
  empty.hidden=count>0;empty.textContent=query?'לא נמצא נכס ברשימת המעקב':snapshot?.error?'רשימת הנכסים אינה זמינה כרגע':'ממתין לרשימת הנכסים';
 }
 search.addEventListener('input',render);
 window.addEventListener('levi:binance-dashboard',e=>{snapshot=e.detail;render();});
 new MutationObserver(render).observe($('chartSymbol'),{childList:true,subtree:true,characterData:true});
 render();window.dispatchEvent(new Event('resize'));
})();
