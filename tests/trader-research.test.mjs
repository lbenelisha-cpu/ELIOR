import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {analyseCompany, reportedSeries} from '../lib/trader-fundamentals.mjs';
import {planResearchTrade} from '../lib/trader-planner.mjs';
import {createResearchService, parseHeadlines, stockSymbol} from '../lib/trader-research-service.mjs';
import {createResearchHandler} from '../netlify/functions/trader-research.mjs';
const at = Date.parse('2026-10-30T10:00:00Z');
const fact = (val, start = '2026-04-01', end = '2026-06-30', rest = {}) => ({val, start, end, filed: '2026-08-01', form: '10-Q', accn: '2026-1', ...rest});
function facts() {
  return {cik: 123, entityName: 'Example Inc.', facts: {'us-gaap': {
    Revenues: {units: {USD: [fact(120), fact(100, '2025-04-01', '2025-06-30'), fact(450, '2025-01-01', '2025-12-31', {form: '10-K'})]}},
    NetIncomeLoss: {units: {USD: [fact(-4), fact(11, '2026-01-01', '2026-06-30')]}},
    EarningsPerShareDiluted: {units: {'USD/shares': [fact(-.2)]}}
  }}};
}
const planInput = {equity: 10000, cash: 10000, occupied: 0, entry: 100, stop: 95, riskPct: 1, costPct: .2, wholeShares: true};
const rss = items => '<rss version="2.0"><channel>' + items + '</channel></rss>';
const item = (title = 'Earnings &amp; results', link = 'https://finance.yahoo.com/news/example', date = 'Fri, 30 Oct 2026 09:00:00 GMT') => `<item><title>${title}</title><link>${link}</link><pubDate>${date}</pubDate></item>`;
const response = data => new Response(typeof data === 'string' ? data : JSON.stringify(data));

test('SEC uses exact periods and currencies; annual/YTD amounts cannot become quarterly earnings', () => {
  const report = analyseCompany(facts(), 'ABC', at), row = report.periods.quarterly[0];
  assert.equal(row.revenue.value, 120); assert.equal(row.netIncome.value, -4); assert.equal(row.eps.value, -.2);
  assert.ok(Math.abs(row.revenueGrowthPct - 20) < 1e-9); assert.equal(report.periods.annual.length, 1);
  assert.equal(report.periods.quarterly.some(r => r.end === '2025-12-31'), false);
  const data = facts(); data.facts['us-gaap'].NetIncomeLoss.units = {EUR: [fact(500)]};
  assert.equal(analyseCompany(data, 'ABC', at).periods.quarterly[0].netIncome, null);
});
test('restatements win, future/malformed values are excluded and missing data is not zero', () => {
  const data = facts(), series = data.facts['us-gaap'].Revenues.units.USD;
  series.push(fact(125, undefined, undefined, {filed: '2026-10-01'}), fact(999, undefined, undefined, {filed: '2026-11-01'}), fact(NaN), fact(1000, '2026-02-30'));
  const row = analyseCompany(data, 'ABC', at).periods.quarterly[0]; assert.equal(row.revenue.value, 125); assert.equal(row.revenue.filed, '2026-10-01');
  delete data.facts['us-gaap'].EarningsPerShareDiluted; assert.equal(analyseCompany(data, 'ABC', at).periods.quarterly[0].eps, null);
  assert.equal(reportedSeries(data, 'unknown', 'annual', at).length, 0);
  assert.throws(() => analyseCompany({facts: {}}, 'ABC'), /INVALID_SEC_RESPONSE/);
});
test('growth is not invented across concept changes or mismatched fiscal durations', () => {
  const data = facts(); data.facts['us-gaap'].RevenueFromContractWithCustomerExcludingAssessedTax = {units: {USD: [fact(200)]}};
  assert.equal(analyseCompany(data, 'ABC', at).periods.quarterly[0].revenueGrowthPct, null);
});
test('risk sizing respects aggregate cash, fee reserve, 20% cap, whole shares and chosen loss budget', () => {
  const snapshot = JSON.stringify(planInput), result = planResearchTrade(planInput);
  assert.equal(result.ok, true); assert.equal(result.quantity, 19); assert.equal(result.notional, 1900);
  assert.equal(result.estimatedLoss, 98.8); assert.equal(JSON.stringify(planInput), snapshot);
  for (const wholeShares of [false, true]) for (const cash of [15, 101, 1000, 10000]) for (const costPct of [0, .2, 5]) {
    const r = planResearchTrade({...planInput, cash, costPct, wholeShares});
    if (!r.ok) continue;
    assert.ok(r.notional + r.estimatedCosts <= Math.min(cash, 2000) + 1e-7);
    assert.ok(r.estimatedLoss <= r.riskBudget + 1e-7); assert.ok(r.cashAfterCostReserve >= -1e-7);
  }
});
test('missing, unsafe, inconsistent and unsupported planning inputs fail closed', () => {
  for (const patch of [{cash: ''}, {equity: NaN}, {entry: Infinity}, {cash: 11000}, {occupied: 5}, {occupied: 1.5}, {stop: 100}, {stop: 101}, {riskPct: 0}, {costPct: -1}, {alreadyHeld: true}, {cash: 0}, {occupied: true}]) {
    assert.equal(planResearchTrade({...planInput, ...patch}).ok, false, JSON.stringify(patch));
  }
  const last = planResearchTrade({...planInput, occupied: 4, cash: 120, wholeShares: false});
  assert.ok(last.ok); assert.ok(last.notional + last.estimatedCosts <= 120);
});
test('news parsing rejects active URLs, unknown dates, future/old stories, DTDs and duplicate links', () => {
  const data = parseHeadlines(rss(item('<![CDATA[<b>News &amp; earnings</b>]]>') + item() + item('Bad', 'javascript:alert(1)') + item('Old', 'https://example.org/old', '1 Jan 2020') + item('Future', 'https://example.org/future', '1 Jan 2030') + item('Unknown', 'https://example.org/unknown', '') + item('Credentials', 'https://a:b@example.org/')), at);
  assert.equal(data.length, 1); assert.equal(data[0].title, 'News & earnings');
  assert.throws(() => parseHeadlines('<html>service error</html>'), /INVALID_NEWS/);
  assert.throws(() => parseHeadlines('<!DOCTYPE rss>' + rss('')), /INVALID_NEWS/);
  assert.deepEqual(parseHeadlines(rss(''), at), []);
});
test('symbol validation cannot become an arbitrary URL or file request', () => {
  assert.equal(stockSymbol(' brk-b '), 'BRK.B');
  for (const symbol of ['', '../secret', 'AAPL?url=https://evil.test', 'BTCUSDT', '<script>', 'https://sec.gov']) assert.throws(() => stockSymbol(symbol), /INVALID_SYMBOL/);
});
test('service performs only fixed public reads, coalesces concurrent requests, caches and keeps timestamps', async () => {
  let clock = at; const calls = [];
  const service = createResearchService({now: () => clock, wait: async () => {}, secUserAgent: 'Unit Test test@unit.invalid', fetchImpl: async (url, options) => {
    calls.push(url); assert.equal(options.redirect, 'error'); assert.equal(options.method, undefined);
    if (url.includes('company_tickers')) return response({0: {ticker: 'ABC', cik_str: 123}});
    if (url.includes('companyfacts')) return response(facts());
    return response(rss(item()));
  }});
  const [a, b] = await Promise.all([service.get('ABC'), service.get('ABC')]); assert.deepEqual(a, b); assert.equal(calls.length, 3);
  assert.equal(a.financials.status, 'OK'); assert.equal(a.news.status, 'OK');
  clock += 1000; const cached = await service.get('ABC'); assert.equal(cached.cached, true); assert.equal(cached.fetchedAt, a.fetchedAt); assert.equal(calls.length, 3);
  clock += 900001; await service.get('ABC'); assert.equal(calls.length, 5); // ticker map retained for a day
});
test('SEC configuration is explicit and source failures stay separate from empty results', async () => {
  let reads = 0;
  const service = createResearchService({now: () => at, fetchImpl: async url => {reads++; assert.ok(url.startsWith('https://feeds.finance.yahoo.com/')); return response('<html>blocked</html>');}});
  const result = await service.get('ABC'); assert.equal(result.financials.status, 'CONFIG_REQUIRED'); assert.equal(result.news.status, 'UNAVAILABLE'); assert.equal(reads, 1);
  const mismatch = createResearchService({now: () => at, wait: async () => {}, secUserAgent: 'Unit Test test@unit.invalid', fetchImpl: async url => response(url.includes('company_tickers') ? {0: {ticker: 'ABC', cik_str: 456}} : url.includes('companyfacts') ? facts() : rss(''))});
  const m = await mismatch.get('ABC'); assert.equal(m.financials.status, 'UNAVAILABLE'); assert.equal(m.news.status, 'OK'); assert.deepEqual(m.news.data, []);
});
test('busy guard and body limits bound outbound work without exposing source error text', async () => {
  const resolvers = [];
  const service = createResearchService({now: () => at, fetchImpl: () => new Promise(resolve => resolvers.push(resolve))});
  const first = service.get('AAA'), second = service.get('BBB'); await assert.rejects(service.get('CCC'), /RESEARCH_BUSY/);
  resolvers.forEach(resolve => resolve(response(rss('')))); await Promise.all([first, second]);
  const limited = createResearchService({now: () => at, fetchImpl: async () => new Response('huge', {headers: {'content-length': '2000001'}})});
  assert.equal((await limited.get('ABC')).news.status, 'UNAVAILABLE');
});
test('HTTP endpoint accepts GET symbol only, never exposes account state and labels partial caching', async () => {
  let calls = 0;
  const handler = createResearchHandler({get: async symbol => {calls++; return {symbol, news: {status: 'OK'}, financials: {status: 'CONFIG_REQUIRED'}};}});
  assert.equal((await handler(new Request('https://app.test/?symbol=AAPL', {method: 'POST'}))).status, 405);
  for (const query of ['?symbol=../secret', '?symbol=AAPL&symbol=MSFT', '?url=https://evil.test', '?symbol=AAPL&key=secret']) assert.equal((await handler(new Request('https://app.test/' + query))).status, 400);
  assert.equal(calls, 0);
  const result = await handler(new Request('https://app.test/?symbol=AAPL')); assert.equal(result.status, 200); assert.match(result.headers.get('cache-control'), /s-maxage=60/); assert.equal(calls, 1);
  const failed = createResearchHandler({get: async () => {throw Error('private-token=never-display');}});
  const failure = await failed(new Request('https://app.test/?symbol=AAPL')); assert.equal(failure.status, 503); assert.doesNotMatch(await failure.text(), /private-token/);
});
test('research UI has no polling, order endpoints, shared trading settings or unsafe HTML insertion', () => {
  const ui = fs.readFileSync(new URL('../trader-research.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /innerHTML|setInterval|localStorage|\/api\/binance|colmex-execution|method:\s*['"]POST/);
  for (const page of ['index.html', 'binance-agent.html', 'colmex-pro.html']) assert.match(fs.readFileSync(new URL('../' + page, import.meta.url), 'utf8'), /href="\/trader-research\.html"/);
});
