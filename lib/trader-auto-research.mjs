import {createResearchService, parseHeadlines} from './trader-research-service.mjs';
const cryptoTickers = {BTCUSDT: 'BTC-USD', ETHUSDT: 'ETH-USD', SOLUSDT: 'SOL-USD', BNBUSDT: 'BNB-USD', XRPUSDT: 'XRP-USD'};
export function createPaperResearch({fetchImpl = globalThis.fetch, secUserAgent = '', now = Date.now} = {}) {
  const service = createResearchService({fetchImpl, secUserAgent, now});
  return async (platform, symbol) => {
    if (platform === 'COLMEX') {
      const result = await service.get(symbol), financials = result.financials;
      return {fetchedAt: result.fetchedAt, news: {...result.news, data: result.news.data?.slice(0, 3) || []},
        financials: {status: financials.status, data: financials.data ? {company: financials.data.company,
          cik: financials.data.cik, annual: financials.data.periods.annual.slice(0, 1), quarterly: financials.data.periods.quarterly.slice(0, 1)} : null}};
    }
    const ticker = cryptoTickers[symbol]; if (!ticker) throw Error('INVALID_SYMBOL');
    let news = {status: 'UNAVAILABLE', data: []};
    try {
      const response = await fetchImpl('https://feeds.finance.yahoo.com/rss/2.0/headline?s=' + ticker + '&region=US&lang=en-US',
        {signal: AbortSignal.timeout(4500), redirect: 'error'});
      if (!response.ok || Number(response.headers.get('content-length')) > 2000000) throw Error('NEWS_UNAVAILABLE');
      const reader = response.body.getReader(), chunks = []; let size = 0;
      try {for (;;) {const {done, value} = await reader.read(); if (done) break; size += value.byteLength;
        if (size > 2000000) throw Error('NEWS_UNAVAILABLE'); chunks.push(value);}}
      finally {await reader.cancel().catch(() => {});}
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
      news = {status: 'OK', data: parseHeadlines(new TextDecoder().decode(bytes), now()).slice(0, 3)};
    } catch { /* Absence is explicit, never fabricated sentiment. */ }
    return {fetchedAt: new Date(now()).toISOString(), news, financials: {status: 'NOT_APPLICABLE', data: null}};
  };
}
