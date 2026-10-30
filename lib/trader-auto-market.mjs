import {td} from './agent.mjs';
import {regularSession} from './colmex-market-hours.mjs';
import {PAPER_MARKETS, validatePaperBars} from './trader-auto-paper.mjs';
export function binancePaperBars(rows, now) {
  if (!Array.isArray(rows)) throw Error('INVALID_MARKET_DATA');
  return rows.map(r => {
    if (!Array.isArray(r) || Number(r[6]) !== Number(r[0]) + 299999) throw Error('INVALID_MARKET_DATA');
    return {openTime: Number(r[0]), closeTime: Number(r[6]) + 1, open: Number(r[1]), high: Number(r[2]),
      low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]), closed: true};
  }).filter(b => b.closeTime <= now);
}
export function stockPaperBars(series, symbol, now) {
  if (series?.meta?.symbol !== symbol || series.meta.currency !== 'USD' ||
      !['Common Stock', 'ETF'].includes(series.meta.type) || !Array.isArray(series.values)) throw Error('INVALID_MARKET_DATA');
  return series.values.map(r => {
    // The request explicitly asks for UTC; reject malformed/ambiguous timestamps.
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r.datetime)) throw Error('INVALID_MARKET_DATA');
    const openTime = Date.parse(r.datetime.replace(' ', 'T') + 'Z');
    return {openTime, closeTime: openTime + 300000, open: Number(r.open), high: Number(r.high),
      low: Number(r.low), close: Number(r.close), volume: r.volume == null ? NaN : Number(r.volume), closed: true};
  }).filter(b => b.closeTime <= now && regularSession(b.openTime)).sort((a, b) => a.closeTime - b.closeTime);
}
export function createPaperMarket({fetchImpl = globalThis.fetch, readStock = td} = {}) {
  return async (platform, symbol, now) => {
    if (!PAPER_MARKETS[platform]?.symbols.includes(symbol)) throw Error('INVALID_SYMBOL');
    let bars;
    if (platform === 'BINANCE') {
      const response = await fetchImpl('https://data-api.binance.vision/api/v3/klines?symbol=' + symbol + '&interval=5m&limit=260',
        {signal: AbortSignal.timeout(4500), redirect: 'error'});
      if (!response.ok) throw Error(response.status === 429 || response.status === 418 ? 'MARKET_RATE_LIMIT' : 'MARKET_UNAVAILABLE');
      bars = binancePaperBars(await response.json(), now);
    } else {
      if (readStock === td && (!process.env.TWELVE_DATA_API_KEY || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)) throw Error('STOCK_SOURCE_NOT_CONFIGURED');
      const series = await readStock('time_series', {symbol, interval: '5min', outputsize: 260, order: 'ASC', adjust: 'splits', timezone: 'UTC', prepost: false}, 60);
      bars = stockPaperBars(series, symbol, now);
    }
    validatePaperBars(bars, platform, now);
    return bars;
  };
}
