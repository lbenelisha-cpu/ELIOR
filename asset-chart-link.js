(function(root){
 'use strict';
 const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function url(symbol,market='SPOT'){
  if(!['STOCK','SPOT','FUTURES'].includes(market)||typeof symbol!=='string')return null;
  if(market!=='STOCK'&&root.LEVI_QUICK_TRADING_PAGE===true)return root.LEVI_BINANCE_TRADINGVIEW_URL?.(symbol,market)||null;
  if(!(market==='STOCK'?/^[A-Z][A-Z0-9.-]{0,14}$/:/^[A-Z0-9]+USDT$/).test(symbol))return null;
  const chart=market==='STOCK'?symbol:'BINANCE:'+symbol+(market==='FUTURES'?'.P':'');
  return root.LEVI_TRADINGVIEW_URL?.(chart)||'https://www.tradingview.com/chart/?symbol='+encodeURIComponent(chart)+'&interval=5';
 }
 function actions(symbol,market){
  if(root.LEVI_QUICK_TRADING_PAGE!==true||market!=='STOCK'||!url(symbol,market))return '';
  return ['BUY','SELL'].map(side=>'<button type="button" class="asset-quick-trade '+side.toLowerCase()+'" data-quick-symbol="'+esc(symbol)+'" data-quick-market="STOCK" data-quick-side="'+side+'" aria-label="'+esc((side==='BUY'?'קנייה מהירה ':'מכירה מהירה ')+symbol)+'">'+(side==='BUY'?'קנייה':'מכירת LONG')+'</button>').join('');
 }
 function linkInfo(symbol,market){
  const href=url(symbol,market);
  if(!href)return null;
  if(root.LEVI_QUICK_TRADING_PAGE===true&&market!=='STOCK'){
   const ticker=new URL(href).searchParams.get('symbol').replace(/^BINANCE:/,'');
   const venue=market==='FUTURES'?'Futures':'Spot';
   return {href,label:'מסחר ב־TradingView ↗',description:'מסחר ב־TradingView · '+ticker+' · '+venue};
  }
  return {href,label:'גרף ↗',description:'פתח גרף '+symbol+' ב־TradingView'};
 }
 function html(symbol,market='SPOT'){
  const link=linkInfo(symbol,market);
  if(!link)return '';
  return '<a class="asset-chart-link" href="'+esc(link.href)+'" target="_blank" rel="noopener noreferrer" aria-label="'+esc(link.description)+'">'+link.label+'</a>'+actions(symbol,market);
 }
 function append(host,symbol,market='SPOT'){
  if(!host)return;
  const link=linkInfo(symbol,market);
  if(!link)return;
  const doc=host.ownerDocument||root.document;
  const anchor=doc.createElement('a');
  anchor.className='asset-chart-link';anchor.href=link.href;anchor.target='_blank';anchor.rel='noopener noreferrer';
  anchor.textContent=link.label;anchor.setAttribute('aria-label',link.description);host.append(anchor);
  const stockActions=actions(symbol,market);
  if(stockActions){const wrap=doc.createElement('span');wrap.innerHTML=stockActions;host.append(wrap);}
  return anchor;
 }
 root.LEVI_ASSET_CHART={url,html,append,actions};
 for(const type of ['click','keydown'])root.document?.addEventListener(type,e=>{
  const button=e.target.closest?.('button.asset-quick-trade[data-quick-market="STOCK"]');
  if(button){
   e.stopPropagation();
   if(type==='click'){e.preventDefault();root.LEVI_QUICK_TRADE?.(button.dataset.quickSide,button.dataset.quickSymbol,'STOCK');}
  }else if(e.target.closest?.('a.asset-chart-link'))e.stopPropagation();
 },true);
})(globalThis);
