(function(root){
 'use strict';
 const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function url(symbol,market='SPOT'){
  if(typeof symbol!=='string'||!(market==='STOCK'?/^[A-Z][A-Z0-9.-]{0,14}$/:/^[A-Z0-9]+USDT$/).test(symbol))return null;
  const chart=market==='STOCK'?symbol:'BINANCE:'+symbol+(market==='FUTURES'?'.P':'');
  return root.LEVI_TRADINGVIEW_URL?.(chart)||'https://www.tradingview.com/chart/?symbol='+encodeURIComponent(chart)+'&interval=5';
 }
 function actions(symbol,market='SPOT'){
  if(root.LEVI_QUICK_TRADING_PAGE!==true||!url(symbol,market)||!['SPOT','FUTURES','STOCK'].includes(market))return '';
  return ['BUY','SELL'].map(side=>'<button type="button" class="asset-quick-trade '+side.toLowerCase()+'" data-quick-symbol="'+esc(symbol)+'" data-quick-market="'+market+'" data-quick-side="'+side+'" aria-label="'+esc((market==='FUTURES'?(side==='BUY'?'פתיחת שורט ':'סגירת שורט '):(side==='BUY'?'קנייה מהירה ':'מכירה מהירה '))+symbol)+'">'+(market==='FUTURES'?(side==='BUY'?'פתיחת שורט':'סגירת שורט'):(side==='BUY'?'קנייה':market==='STOCK'?'מכירת LONG':'מכירה'))+'</button>').join('');
 }
 function html(symbol,market){const href=url(symbol,market);return href?'<a class="asset-chart-link" href="'+esc(href)+'" target="_blank" rel="noopener noreferrer" aria-label="פתח גרף '+esc(symbol)+' ב־TradingView">גרף ↗</a>'+actions(symbol,market):'';}
 function append(host,symbol,market){const href=url(symbol,market);if(!host||!href)return;const a=(host.ownerDocument||root.document).createElement('a');a.className='asset-chart-link';a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.textContent='גרף ↗';a.setAttribute('aria-label','פתח גרף '+symbol+' ב־TradingView');host.append(a);const wrap=(host.ownerDocument||root.document).createElement('span');wrap.innerHTML=actions(symbol,market);host.append(wrap);return a;}
 root.LEVI_ASSET_CHART={url,html,append,actions};
 // A chart link must not also select its enclosing scanner row.
 for(const type of ['click','keydown'])root.document?.addEventListener(type,e=>{const b=e.target.closest?.('button.asset-quick-trade');if(b){e.stopPropagation();if(type==='click'){e.preventDefault();root.LEVI_QUICK_TRADE?.(b.dataset.quickSide,b.dataset.quickSymbol,b.dataset.quickMarket);}}else if(e.target.closest?.('a.asset-chart-link'))e.stopPropagation();},true);
})(globalThis);
