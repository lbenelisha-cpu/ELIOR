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
  root.LEVI_BINANCE_TRADINGVIEW_URL = (pair, market) => {
    if (market !== 'SPOT' && market !== 'FUTURES') return null;
    // Binance lists the AAOI bStock and its perpetual under different tickers.
    if (pair === 'AAOI' || pair === 'AAOIUSDT' || pair === 'AAOIBUSDT') {
      pair = market === 'SPOT' ? 'AAOIBUSDT' : 'AAOIUSDT';
    }
    if (typeof pair !== 'string' || !/^[A-Z0-9]+USDT$/.test(pair)) return null;
    const url = chartUrl('BINANCE:' + pair + (market === 'FUTURES' ? '.P' : ''));
    url.searchParams.set('trade-now', 'BINANCE');
    return url.href;
  };

  root.LEVI_COLMEX_TRADINGVIEW_URL = symbol => {
    if (typeof symbol !== 'string' || !/^(NASDAQ|NYSE|AMEX):[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) return null;
    const url = chartUrl(symbol);
    url.searchParams.set('trade-now', 'COLMEX');
    return url.href;
  };
  const stocks = root.LEVI_COLMEX_TRADINGVIEW_URL('NASDAQ:AAPL');
  for (const link of root.document?.querySelectorAll('a[data-colmex-tradingview]') || []) {
    link.href = stocks;
  }
})(globalThis);
