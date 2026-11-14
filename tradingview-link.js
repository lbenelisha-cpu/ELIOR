(function (root) {
  const defaultLayout = 'https://www.tradingview.com/chart/SjakpoXv/';

  function chartUrl(symbol) {
    let base = defaultLayout;
    try {
      const saved = root.localStorage.getItem('levi-tv-layout');
      if (saved) {
        const url = new URL(saved);
        if (url.origin === 'https://www.tradingview.com' && /^\/chart\/[a-zA-Z0-9]+\/?$/.test(url.pathname)) {
          base = url.origin + url.pathname;
        }
      }
    } catch {
      // The default layout also works when browser storage is unavailable.
    }
    const url = new URL(base);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', '5');
    return url;
  }

  root.LEVI_TRADINGVIEW_URL = symbol => chartUrl(symbol).href;
  const stocks = chartUrl('NASDAQ:AAPL');
  stocks.searchParams.set('trade-now', 'COLMEX');
  for (const link of root.document?.querySelectorAll('a[data-colmex-tradingview]') || []) {
    link.href = stocks.href;
  }
})(globalThis);
