(function(root){
 'use strict';
 const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function url(symbol,market='SPOT'){
  if(typeof symbol!=='string'||!(market==='STOCK'?/^[A-Z][A-Z0-9.-]{0,14}$/:/^[A-Z0-9]+USDT$/).test(symbol))return null;
  const chart=market==='STOCK'?symbol:'BINANCE:'+symbol+(market==='FUTURES'?'.P':'');
  return root.LEVI_TRADINGVIEW_URL?.(chart)||'https://www.tradingview.com/chart/?symbol='+encodeURIComponent(chart)+'&interval=5';
 }
 function html(symbol,market){const href=url(symbol,market);return href?'<a class="asset-chart-link" href="'+esc(href)+'" target="_blank" rel="noopener noreferrer" aria-label="פתח גרף '+esc(symbol)+' ב־TradingView">גרף ↗</a>':'';}
 function append(host,symbol,market){const href=url(symbol,market);if(!host||!href)return;const a=(host.ownerDocument||root.document).createElement('a');a.className='asset-chart-link';a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.textContent='גרף ↗';a.setAttribute('aria-label','פתח גרף '+symbol+' ב־TradingView');host.append(a);return a;}
 root.LEVI_ASSET_CHART={url,html,append};
 // A chart link must not also select its enclosing scanner row.
 for(const type of ['click','keydown'])root.document?.addEventListener(type,e=>{if(e.target.closest?.('a.asset-chart-link'))e.stopPropagation();},true);
})(globalThis);
