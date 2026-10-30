import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PAPER_POLICY, newPaperState, processPaperSymbol, paperSummary, validatePaperBars, expirePaperSignals} from '../lib/trader-auto-paper.mjs';
import {binancePaperBars, stockPaperBars, createPaperMarket} from '../lib/trader-auto-market.mjs';
import {runPaperPlatform} from '../lib/trader-auto-runner.mjs';
import {createPaperMonitor} from '../netlify/functions/trader-auto-monitor.mjs';
import {createPaperStatus} from '../netlify/functions/trader-auto-status.mjs';

const step = 300000, end = Date.parse('2026-10-26T19:30:00Z');
function spring(platform = 'BINANCE') {
  const nums = [...Array.from({length: 170}, (_, i) => i * .5), ...Array(50).fill(95), 95, 97, 100, 90, 80, 85, 92, 87, 82, 84, 86, 85, 86, 79, 81];
  const times = [];
  for (const day of ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26'])
    for (let i = 0; i < 78; i++) {const t = Date.parse(day + 'T13:30:00Z') + i * step; if (t + step <= end) times.push(t);}
  const regular = times.slice(-nums.length);
  return nums.map((n, i) => {const openTime = platform === 'COLMEX' ? regular[i] : end - (nums.length - i) * step;
    return {openTime, closeTime: openTime + step, open: 100 + (n - ([220, 221].includes(i) ? 1 : 0)) * .01,
      high: 100 + (i === 230 ? 93 : n) * .01, low: 100 + (n - ([220, 221].includes(i) ? 1 : 0)) * .01,
      close: 100 + n * .01, volume: 1000, closed: true};});
}
function next(bars, close = bars.at(-1).close) {const prev = bars.at(-1); return [...bars, {openTime: prev.closeTime,
  closeTime: prev.closeTime + step, open: prev.close, close, high: Math.max(prev.close, close), low: Math.min(prev.close, close), volume: 1000, closed: true}];}
function pending(platform = 'BINANCE') {
  const symbol = platform === 'BINANCE' ? 'BTCUSDT' : 'AAPL', state = newPaperState(platform, end - step), bars = spring(platform);
  processPaperSymbol(state, symbol, bars, end + 1000);
  assert.ok(state.pending[symbol]); return {state, symbol, bars};
}
function opened(platform = 'BINANCE') {const sample = pending(platform); sample.bars = next(sample.bars);
  processPaperSymbol(sample.state, sample.symbol, sample.bars, end + step + 1000); assert.equal(sample.state.buys, 1); return sample;}
function memoryStore() {
  const values = new Map(); let seq = 0;
  return {values, async getWithMetadata(key) {return structuredClone(values.get(key) || null);}, async get(key) {return structuredClone(values.get(key)?.data || null);},
    async setJSON(key, data, options) {const old = values.get(key); if (options.onlyIfNew && old || options.onlyIfMatch && options.onlyIfMatch !== old?.etag) return {modified: false};
      values.set(key, {data: structuredClone(data), etag: String(++seq)}); return {modified: true};}};
}

test('both real quality rules create a pending signal, never fill the observation candle, and wait for a subsequent close', () => {
  for (const platform of ['BINANCE', 'COLMEX']) {
    const {state, symbol, bars} = pending(platform);
    assert.equal(state.buys, 0); assert.equal(state.cash, 10000);
    processPaperSymbol(state, symbol, bars, end + 2000); assert.equal(state.buys, 0);
    processPaperSymbol(state, symbol, next(bars), end + step + 1000);
    assert.equal(state.buys, 1); assert.ok(state.positions[symbol]);
    assert.ok(state.journal.at(-1).dataAt > state.journal.at(-1).observedAt);
    const bought = structuredClone(state); processPaperSymbol(state, symbol, next(bars), end + step + 2000);
    assert.equal(state.buys, 1); assert.equal(state.cash, bought.cash);
    if (platform === 'COLMEX') assert.ok(Number.isInteger(state.positions[symbol].quantity));
  }
});
test('signals at or before activation do not enter; failed volume confirmation never creates pending', () => {
  for (const platform of ['BINANCE', 'COLMEX']) {
    const state = newPaperState(platform, end + 1000), symbol = platform === 'BINANCE' ? 'BTCUSDT' : 'AAPL';
    processPaperSymbol(state, symbol, spring(platform), end + 2000); assert.equal(Object.keys(state.pending).length, 0);
    const low = spring(platform); low.at(-1).volume = 1;
    const older = newPaperState(platform, end - step); processPaperSymbol(older, symbol, low, end + 1000);
    assert.equal(older.decisions[symbol].reason, 'CONFIRMATION_VOLUME_LOW'); assert.equal(older.buys, 0);
  }
});
test('entry accounting reserves fees, respects cash, allocation and risk, and cannot leak between platforms', () => {
  const {state, symbol} = opened(), p = state.positions[symbol], notional = p.quantity * p.entryPrice;
  assert.ok(Math.abs(state.cash + p.cost - 10000) < 1e-8);
  assert.ok(notional * 1.002 <= 2000); assert.ok(notional * (p.stopLossPct / 100 + .002) <= 8 + 1e-8);
  assert.ok(state.fees > 0); assert.ok(Math.abs(paperSummary(state).pnl + state.fees) < 1e-8);
  const colmex = newPaperState('COLMEX', end); assert.equal(colmex.cash, 10000); assert.deepEqual(colmex.positions, {});
  const small = pending(); small.state.cash = 1;
  processPaperSymbol(small.state, small.symbol, next(small.bars), end + step + 1000);
  assert.ok(small.state.cash >= 0); assert.ok(small.state.positions[small.symbol].cost <= 1);
});
test('sampled-close exits use observed price, deduct sell costs once, and reconcile total PnL', () => {
  const {state, symbol, bars} = opened(), p = structuredClone(state.positions[symbol]);
  const down = next(bars, 98), now = down.at(-1).closeTime + 1000;
  processPaperSymbol(state, symbol, down, now);
  assert.equal(state.sells, 1); assert.equal(state.positions[symbol], undefined);
  const expected = p.quantity * 98 * .999 - p.cost;
  assert.ok(Math.abs(state.realizedPnl - expected) < 1e-8); assert.ok(Math.abs(paperSummary(state).pnl - expected) < 1e-8);
  assert.equal(state.journal.at(-1).price, 98); assert.ok(state.journal.at(-1).price < p.stopPrice);
  processPaperSymbol(state, symbol, down, now + 1000); assert.equal(state.sells, 1); assert.equal(state.buys, 1);
});
test('trailing profit locks only sampled gains and exits after the sampled price gives back the gap', () => {
  const {state, symbol, bars} = opened(), up = next(bars, 107);
  processPaperSymbol(state, symbol, up, up.at(-1).closeTime + 1000);
  assert.equal(state.sells, 0); assert.equal(state.positions[symbol].profitFloorArmed, true);
  const down = next(up, 105); processPaperSymbol(state, symbol, down, down.at(-1).closeTime + 1000);
  assert.equal(state.sells, 1); assert.equal(state.journal.at(-1).reason, 'TRAILING_PROFIT_EXIT');
});
test('an expired or invalidated setup is cancelled without a retroactive fill', () => {
  const a = pending(); expirePaperSignals(a.state, end + 3 * step);
  assert.equal(a.state.pending[a.symbol], undefined); assert.equal(a.state.journal.at(-1).reason, 'SIGNAL_EXPIRED');
  const b = pending(); processPaperSymbol(b.state, b.symbol, next(b.bars, 100.7), end + step + 1000);
  assert.equal(b.state.buys, 0); assert.equal(b.state.pending[b.symbol], undefined);
});
test('incomplete, malformed, duplicate, stale, future and gapped bars cannot fill', () => {
  const cases = [b => b.slice(-203), b => {b.at(-1).volume = NaN; return b;}, b => {b.at(-1).high = 1; return b;},
    b => {b.at(-1).closed = false; return b;}, b => {b[10] = b[9]; return b;}, b => b.filter((_, i) => i !== 20)];
  for (const mutate of cases) {const {state, symbol, bars} = pending();
    assert.throws(() => processPaperSymbol(state, symbol, mutate(next(bars)), end + step + 1000)); assert.equal(state.buys, 0);}
  assert.throws(() => validatePaperBars(spring(), 'BINANCE', end + 420001), /STALE/);
  assert.throws(() => validatePaperBars(next(spring()), 'BINANCE', end + 1000), /INVALID/);
  assert.doesNotThrow(() => validatePaperBars(spring('COLMEX'), 'COLMEX', end + 1000));
});
test('five occupied slots block entries, and insufficient whole-share budget cancels Colmex pending', () => {
  const {state, symbol, bars} = pending();
  state.positions = Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map(s => [s, {}]));
  processPaperSymbol(state, symbol, next(bars), end + step + 1000); assert.equal(state.decisions[symbol].reason, 'MAX_POSITIONS');
  const c = pending('COLMEX'); c.state.cash = 1; processPaperSymbol(c.state, c.symbol, next(c.bars), end + step + 1000);
  assert.equal(c.state.buys, 0); assert.equal(c.state.decisions[c.symbol].reason, 'INSUFFICIENT_PAPER_CASH');
});
test('provider adapters filter unfinished bars, preserve stock volume and request only allowed read endpoints', async () => {
  const raw = next(spring()).map(b => [b.openTime, b.open, b.high, b.low, b.close, b.volume, b.closeTime - 1]);
  assert.equal(binancePaperBars(raw, end + 1000).length, raw.length - 1);
  const stock = spring('COLMEX'), series = {meta: {symbol: 'AAPL', currency: 'USD', type: 'Common Stock'}, values: stock.map(b =>
    ({datetime: new Date(b.openTime).toISOString().slice(0, 19).replace('T', ' '), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume}))};
  assert.deepEqual(stockPaperBars(series, 'AAPL', end + 1000), stock);
  let calls = 0; const market = createPaperMarket({fetchImpl: async (url, options) => {calls++;
    assert.equal(new URL(url).origin, 'https://data-api.binance.vision'); assert.equal(new URL(url).pathname, '/api/v3/klines');
    assert.equal(options.method, undefined); assert.equal(options.headers?.Authorization, undefined);
    return {ok: true, json: async () => raw};}, readStock: async (endpoint, params, ttl) => {
      assert.equal(endpoint, 'time_series'); assert.equal(params.interval, '5min'); assert.equal(params.prepost, false); assert.equal(ttl, 60); return series;}});
  await market('BINANCE', 'BTCUSDT', end + 1000); await market('COLMEX', 'AAPL', end + 1000);
  await assert.rejects(market('BINANCE', 'UNLISTEDUSDT', end + 1000), /INVALID_SYMBOL/); assert.equal(calls, 1);
});
test('concurrent first runs commit once, retries skip market reads, and research remains separate context', async () => {
  const store = memoryStore(); let reads = 0;
  const args = {platform: 'BINANCE', store, now: end - step, clock: () => end - step, readMarket: async () => {reads++; return spring().slice(0, -1);}};
  const results = await Promise.all([runPaperPlatform(args), runPaperPlatform(args)]);
  assert.equal(results.filter(r => r.reason === 'SAVED').length, 1); assert.equal(results.filter(r => r.reason === 'CONCURRENT_CYCLE_DISCARDED').length, 1);
  const count = reads; assert.equal((await runPaperPlatform(args)).reason, 'ALREADY_PROCESSED'); assert.equal(reads, count);
  await runPaperPlatform({...args, now: end + 1000, clock: () => end + 1000, readMarket: async () => spring(), research: async () => {throw Error('unavailable');}});
  const saved = await store.get('binance'); assert.equal(saved.buys, 0); assert.equal(Object.keys(saved.pending).length, 2);
  assert.equal(Object.values(saved.pending)[0].research.news.status, 'UNAVAILABLE');
});
test('source failure on any holding blocks a different pending entry; paused mode still manages exits', async () => {
  const {state, bars} = opened(); const another = pending(); state.pending.ETHUSDT = another.state.pending.BTCUSDT;
  const store = memoryStore(); await store.setJSON('binance', state, {onlyIfNew: true});
  const now = end + 2 * step + 1000;
  await runPaperPlatform({platform: 'BINANCE', store, now, clock: () => now,
    readMarket: async (_, symbol) => {if (symbol === 'BTCUSDT') throw Error('unavailable'); return next(bars);}});
  let saved = await store.get('binance'); assert.equal(saved.buys, 1); assert.equal(saved.status, 'PARTIAL_DATA'); assert.equal(saved.decisions.ETHUSDT.reason, 'ENTRY_PAUSED');
  const later = now + step, down = next(next(bars), 98);
  await runPaperPlatform({platform: 'BINANCE', store, enabled: false, now: later, clock: () => later, readMarket: async () => down});
  saved = await store.get('binance'); assert.equal(saved.sells, 1); assert.equal(saved.buys, 1);
});
test('production schedule is guarded; public API is read-only and never starts a cycle', async () => {
  let stores = 0, reads = 0; const store = memoryStore();
  const monitor = createPaperMonitor({getStore: () => {stores++; return store;}, readMarket: async () => {reads++; return spring();}, clock: () => end + 1000, env: {}});
  for (const context of [{}, {deploy: {context: 'deploy-preview'}}, {deploy: {context: 'branch-deploy'}}])
    assert.equal((await monitor(new Request('https://example.test'), context)).status, 204);
  assert.equal(stores, 0); assert.equal(reads, 0);
  const status = createPaperStatus({getStore: () => store, now: () => end});
  assert.equal((await status(new Request('https://example.test', {method: 'POST'}))).status, 405);
  const data = await (await status(new Request('https://example.test'))).json(); assert.equal(data.mode, 'PAPER_ONLY');
  assert.ok(data.platforms.every(p => p.state === null)); assert.equal(store.values.size, 0); assert.equal(reads, 0);
  await monitor(new Request('https://example.test'), {deploy: {context: 'production'}});
  assert.equal(store.values.size, 2); assert.equal(reads, 4);
});
test('Colmex waits outside regular sessions without spending data quota', async () => {
  const store = memoryStore(), now = Date.parse('2026-10-25T15:00:00Z'); let calls = 0;
  await runPaperPlatform({platform: 'COLMEX', store, now, clock: () => now, readMarket: async () => {calls++; throw Error('should not call');}});
  assert.equal(calls, 0); assert.equal((await store.get('colmex')).status, 'MARKET_CLOSED');
});
test('new paper files contain no live broker write or account activation path', () => {
  for (const name of ['lib/trader-auto-paper.mjs', 'lib/trader-auto-runner.mjs', 'lib/trader-auto-market.mjs', 'lib/trader-auto-store.mjs',
    'netlify/functions/trader-auto-monitor.mjs', 'netlify/functions/trader-auto-status.mjs', 'trader-auto-ui.js']) {
    const source = fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /AutoBroker|signedBinance|colmex-auto-store|COLMEX_AUTO_LIVE_ENABLED|\/api\/v3\/order|placeLiveMarket/);
  }
  assert.equal(PAPER_POLICY.fillModel, 'NEXT_OBSERVED_CLOSED_BAR');
});
