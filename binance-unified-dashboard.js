/* Trading workspace for the selected chart and live account. */
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
 const search=make('input');search.type='search';search.placeholder='חיפוש נכס · BTC, AAOI…';search.setAttribute('aria-label','חיפוש נכס');search.autocomplete='off';
 const strip=make('div',null,'unified-asset-strip');strip.setAttribute('role','group');strip.setAttribute('aria-label','מעבר בין נכסים');
 const empty=make('small','ממתין לרשימת הנכסים');empty.setAttribute('role','status');
 nav.append(search,strip,empty);head.before(nav);
 // The stock and its two Binance products have different exchange symbols.
 // Offer the verified instruments even when the rotating scanner omits AAOI.
 function addAaoiMarkets(input,after){
  if(!input||!after)return;
  const group=make('div',null,'aaoi-trading-markets');
  group.setAttribute('role','group');group.setAttribute('aria-label','מסחר ב־AAOI דרך TradingView');
  group.append(make('strong','AAOI ב־TradingView'));
  const choices=[
   {label:'Spot · bStock · AAOIBUSDT',matches:['AAOIB','AAOIBUSDT','BINANCE:AAOIBUSDT'],href:window.LEVI_BINANCE_TRADINGVIEW_URL?.('AAOIBUSDT','SPOT')},
   {label:'Futures · חוזה · AAOIUSDT.P',matches:['AAOIUSDT','AAOIUSDT.P','BINANCE:AAOIUSDT.P'],href:window.LEVI_BINANCE_TRADINGVIEW_URL?.('AAOIUSDT','FUTURES')},
   {label:'Colmex · מניה · NASDAQ:AAOI',matches:['NASDAQ:AAOI'],href:window.LEVI_COLMEX_TRADINGVIEW_URL?.('NASDAQ:AAOI')}
  ].filter(choice=>choice.href);
  for(const choice of choices){
   const link=make('a',choice.label+' ↗','tradingview-link');
   link.href=choice.href;link.target='_blank';link.rel='noopener noreferrer';link.dir='ltr';
   group.append(link);choice.link=link;
  }
  function showMatches(){
   const query=input.value.trim().toUpperCase().replace(/[\s/\-]/g,'');
   for(const choice of choices)choice.link.hidden=query!=='AAOI'&&!choice.matches.includes(query);
   group.hidden=choices.every(choice=>choice.link.hidden);
  }
  after.after(group);input.addEventListener('input',showMatches);showMatches();
  return group;
 }
 const tradeMarkets=addAaoiMarkets(search,nav);
 addAaoiMarkets($('assetSearch'),$('assetSearchStatus'));
 const market=make('select');market.setAttribute('aria-label','מסלול הפוזיציה המוצג');market.className='unified-market';
 for(const [value,label] of [['SPOT','LONG · Spot'],['FUTURES','SHORT · Futures']]){const option=make('option',label);option.value=value;market.append(option);}head.append(market);
 market.addEventListener('change',()=>window.dispatchEvent(new CustomEvent('levi-chart-market',{detail:market.value})));
 head.after(actions);
 const terminal=$('chartTerminal');actions.after(terminal);
 const note=make('p','הנרות בגרף זה מציגים מחירי Spot. רמות מחוץ לטווח מופיעות בכרטיסי המחירים.','unified-source');terminal.before(note);
 // The price cards and candles are the single main view. Expanded diagnostics
 // retain all original DOM IDs, live subscriptions, and copy-to-TradingView controls.
 const details=make('details',null,'unified-details unified-analysis');details.append(make('summary','ניתוח הנכס · הגנות, אינדיקטורים וכלי גרף'));
 const keep=new Set([nav,tradeMarkets,head,actions,terminal,note]);
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
 const monitor=$('pocLiveMonitor');if(monitor){monitor.dataset.compact='true';metrics.after(monitor);}
 fold([$('terminalLedgers')],'החזקות ויציאות אחרונות','app-view trade-view portfolio-view');
 for(const [id,title,classes] of [
  ['futuresPositionsPanel','חשבון Futures · פוזיציות SHORT והגנות','app-view trade-view portfolio-view'],
  ['marketAttentionPanel','איתותים ותצפיתנים','app-view trade-view scans-view'],
  ['maDecisionJournal','יומן השוואת החלטות','app-view trade-view portfolio-view']
 ])fold([$(id)],title,classes);
 $('overviewTitle').textContent='מרכז המסחר שלך';
 const subtitle=overview.querySelector('.overview-sub');if(subtitle)subtitle.textContent='בחר נכס לצפייה בגרף ובהגנות או למסחר ידני ב־TradingView';
 let snapshot=window.LEVI_DASHBOARD_SNAPSHOT||null,key='';
 function render(){
  const selection=window.LEVI_CHART_SELECTION?.();
  if(selection)market.value=selection.market;
  const query=search.value.trim().toUpperCase().replace(/[\s/\-]/g,'');
  const rows=new Map();
  for(const a of snapshot?.agent?.agents||[]){
   if(/^[A-Z0-9]+USDT$/.test(a.symbol))rows.set(a.symbol,{symbol:a.symbol,long:a.position==='LONG',short:false});
  }
  for(const balance of snapshot?.account?.balances||[]){
   const row=rows.get(balance.asset+'USDT');
   if(row&&Number(balance.valueUsdt)>=5)row.long=true;
  }
  for(const symbol of selection?.shortSymbols||[]){
   if(!/^[A-Z0-9]+USDT$/.test(symbol))continue;
   const row=rows.get(symbol)||{symbol,long:false};
   row.short=true;rows.set(symbol,row);
  }
  const sorted=[...rows.values()].sort((a,b)=>Number(b.long||b.short)-Number(a.long||a.short)||a.symbol.localeCompare(b.symbol));
  const next=JSON.stringify([sorted,selection?.symbol,selection?.market,query,snapshot?.error]);if(next===key)return;key=next;
  strip.replaceChildren();let count=0;
  for(const row of sorted){
   if(query&&!row.symbol.includes(query))continue;
   const markets=row.short?(row.long?['SPOT','FUTURES']:['FUTURES']):['SPOT'];
   for(const venue of markets){
    const label=row.symbol+(venue==='FUTURES'?' · SHORT':row.long?' · LONG':'');
    const button=make('button',label,'unified-asset');button.type='button';button.dataset.symbol=row.symbol;
    button.setAttribute('aria-pressed',String(row.symbol===selection?.symbol&&venue===selection.market));
    button.addEventListener('click',()=>window.dispatchEvent(new CustomEvent('levi-dashboard-select',{detail:{symbol:row.symbol,market:row.long||row.short?venue:null}})));
    strip.append(button);count++;
   }
  }
  empty.hidden=count>0;empty.textContent=query?'לא נמצא נכס ברשימת המעקב':snapshot?.error?'רשימת הנכסים אינה זמינה כרגע':'ממתין לרשימת הנכסים';
 }
 search.addEventListener('input',render);
 window.addEventListener('levi:binance-dashboard',e=>{snapshot=e.detail;render();});
 window.addEventListener('levi:chart-selection',render);
 render();window.dispatchEvent(new Event('resize'));
})();
