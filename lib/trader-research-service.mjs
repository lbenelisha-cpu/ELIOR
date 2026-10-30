import {analyseCompany} from './trader-fundamentals.mjs';
// News source and SEC workflow adapted from trader-skill (MIT); see attribution.
const UA = 'LeviInvestResearch/1.0 (+https://github.com/lbenelisha-cpu/ELIOR)';
const DAY = 86400000;
export function stockSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase().replace('-', '.');
  if (!/^[A-Z]{1,5}(?:\.[A-Z]{1,2})?$/.test(symbol)) throw Error('INVALID_SYMBOL');
  return symbol;
}
function decode(value) {
  return value.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => {
    const point = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  }).replace(/&(amp|lt|gt|quot|apos);/g, (_, x) => ({amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"})[x]);
}
export function parseHeadlines(xml, now = Date.now()) {
  if (typeof xml !== 'string' || !/<rss[\s>]/i.test(xml) || !/<\/rss>\s*$/i.test(xml) || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('INVALID_NEWS_RESPONSE');
  const read = (text, tag) => decode((text.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i'))?.[1] || '').trim());
  const seen = new Set(), rows = [];
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const item = match[1], title = read(item, 'title').replace(/<[^>]*>/g, '').slice(0, 400);
    const publishedAt = Date.parse(read(item, 'pubDate'));
    let url;
    try { url = new URL(read(item, 'link')); } catch { continue; }
    if (!title || url.protocol !== 'https:' || url.username || url.password || !Number.isFinite(publishedAt) || publishedAt > now + 300000 || now - publishedAt > 7 * DAY || seen.has(url.href)) continue;
    seen.add(url.href);
    rows.push({title, url: url.href, publishedAt: new Date(publishedAt).toISOString(), source: 'Yahoo Finance RSS'});
  }
  return rows.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 12);
}

export function createResearchService({fetchImpl = globalThis.fetch, now = Date.now, secUserAgent = '', wait = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  const reports = new Map(), pending = new Map();
  let tickerCache = null, tickerPending = null, nextSecAt = 0;
  const configured = /\S+@\S+\.\S+/.test(secUserAgent) && !/example\.(com|org)|you@/i.test(secUserAgent) && !/[\r\n]/.test(secUserAgent);
  async function read(url, signal, {sec = false, json = false, maxBytes = 2000000} = {}) {
    if (sec) {
      const delay = Math.max(0, nextSecAt - now()); nextSecAt = Math.max(now(), nextSecAt) + 300;
      if (delay) await wait(delay);
      signal.throwIfAborted();
    }
    const response = await fetchImpl(url, {signal, redirect: 'error', headers: {'User-Agent': sec ? secUserAgent : UA, Accept: json ? 'application/json' : 'application/rss+xml, application/xml'}});
    if (!response.ok) throw Error(response.status === 429 ? 'SOURCE_RATE_LIMIT' : 'SOURCE_UNAVAILABLE');
    if (Number(response.headers.get('content-length')) > maxBytes) throw Error('SOURCE_TOO_LARGE');
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read(); if (done) break;
        size += value.byteLength; if (size > maxBytes) throw Error('SOURCE_TOO_LARGE'); chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder().decode(bytes);
    return json ? JSON.parse(text) : text;
  }
  async function tickers(signal) {
    if (tickerCache && now() - tickerCache.at < DAY) return tickerCache.data;
    if (tickerPending) return tickerPending;
    tickerPending = read('https://www.sec.gov/files/company_tickers.json', signal, {sec: true, json: true, maxBytes: 4000000}).then(data => {
      if (!data || typeof data !== 'object' || !Object.values(data).some(row => row?.ticker && row?.cik_str)) throw Error('INVALID_SEC_RESPONSE');
      tickerCache = {at: now(), data}; return data;
    }).finally(() => { tickerPending = null; });
    return tickerPending;
  }
  async function fundamentals(symbol, signal) {
    if (!configured) return {status: 'CONFIG_REQUIRED', data: null};
    const mapping = await tickers(signal);
    const company = Object.values(mapping).find(row => String(row?.ticker || '').toUpperCase().replace('-', '.') === symbol);
    if (!company || !/^\d{1,10}$/.test(String(company.cik_str))) return {status: 'NOT_COVERED', data: null};
    const cik = String(company.cik_str).padStart(10, '0');
    const data = await read('https://data.sec.gov/api/xbrl/companyfacts/CIK' + cik + '.json', signal, {sec: true, json: true, maxBytes: 16000000});
    if (Number(data?.cik) !== Number(cik)) throw Error('INVALID_SEC_RESPONSE');
    const report = analyseCompany(data, symbol, now());
    return {status: report.periods.annual.length || report.periods.quarterly.length ? 'OK' : 'NOT_COVERED', data: report};
  }
  const unavailable = () => ({status: 'UNAVAILABLE', data: null});
  async function build(symbol) {
    const signal = AbortSignal.timeout(8500);
    const [news, financials] = await Promise.all([
      read('https://feeds.finance.yahoo.com/rss/2.0/headline?s=' + encodeURIComponent(symbol.replace('.', '-')) + '&region=US&lang=en-US', signal)
        .then(xml => ({status: 'OK', data: parseHeadlines(xml, now())})).catch(unavailable),
      fundamentals(symbol, signal).catch(unavailable)
    ]);
    const data = {version: 'TRADER_RESEARCH_V1', mode: 'RESEARCH_ONLY', symbol, fetchedAt: new Date(now()).toISOString(), news, financials};
    const ttl = news.status === 'OK' && financials.status === 'OK' ? 900000 : 60000;
    if (reports.size >= 64) reports.delete(reports.keys().next().value);
    reports.set(symbol, {data, until: now() + ttl});
    return data;
  }
  return {async get(value) {
    const symbol = stockSymbol(value), cached = reports.get(symbol);
    if (cached && cached.until > now()) return {...cached.data, cached: true};
    if (pending.has(symbol)) return pending.get(symbol);
    if (pending.size >= 2) throw Error('RESEARCH_BUSY');
    const request = build(symbol).finally(() => pending.delete(symbol)); pending.set(symbol, request);
    return request;
  }};
}
