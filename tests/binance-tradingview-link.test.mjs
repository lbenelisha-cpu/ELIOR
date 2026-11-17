import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('../tradingview-link.js', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../binance-unified-dashboard.js', import.meta.url), 'utf8');

function workspace(savedLayout) {
  const stockLink = {};
  const window = vm.createContext({
    URL,
    localStorage: {getItem: key => key === 'levi-tv-layout' ? savedLayout : null},
    document: {querySelectorAll: () => [stockLink]}
  });
  vm.runInContext(script, window);
  return {url: window.LEVI_BINANCE_TRADINGVIEW_URL, stockUrl: window.LEVI_COLMEX_TRADINGVIEW_URL, stockLink};
}

test('search exposes AAOI instruments without a scanner snapshot, and exact symbols narrow the destination', () => {
  const {url, stockUrl} = workspace();
  const input = {value: '', addEventListener(type, callback) { this[type] = callback; }};
  const make = () => ({children: [], setAttribute() {}, append(child) { this.children.push(child); }});
  const context = {window: {LEVI_BINANCE_TRADINGVIEW_URL: url, LEVI_COLMEX_TRADINGVIEW_URL: stockUrl}, make, input};
  const source = dashboard.slice(dashboard.indexOf(' function addAaoiMarkets('), dashboard.indexOf(' const tradeMarkets='));
  const group = vm.runInNewContext(source + '\naddAaoiMarkets(input, {after() {}});', context);
  function matches(query) {
    input.value = query;
    input.input();
    return group.children.filter(link => link.href && !link.hidden).map(link => new URL(link.href).searchParams.get('symbol'));
  }
  assert.equal(group.hidden, true);
  assert.deepEqual(matches('aaoi'), ['BINANCE:AAOIBUSDT', 'BINANCE:AAOIUSDT.P', 'NASDAQ:AAOI']);
  assert.deepEqual(matches('AAOIB/USDT'), ['BINANCE:AAOIBUSDT']);
  assert.deepEqual(matches('BINANCE:AAOIUSDT.P'), ['BINANCE:AAOIUSDT.P']);
  assert.deepEqual(matches('NASDAQ:AAOI'), ['NASDAQ:AAOI']);
  assert.deepEqual(matches('ETH'), []);
  assert.equal(group.hidden, true);
});

test('the Binance handoff opens the selected chart and broker in the saved layout', () => {
  const {url, stockLink} = workspace('https://www.tradingview.com/chart/MyLayout1/?symbol=NASDAQ:AAPL&side=sell');
  for (const [market, symbol] of [['SPOT', 'BINANCE:ADAUSDT'], ['FUTURES', 'BINANCE:ADAUSDT.P']]) {
    const target = new URL(url('ADAUSDT', market));
    assert.equal(target.origin, 'https://www.tradingview.com');
    assert.equal(target.pathname, '/chart/MyLayout1/');
    assert.deepEqual(Object.fromEntries(target.searchParams), {symbol, interval: '5', 'trade-now': 'BINANCE'});
  }
  assert.equal(new URL(stockLink.href).searchParams.get('symbol'), 'NASDAQ:AAPL');
  assert.equal(new URL(stockLink.href).searchParams.get('trade-now'), 'COLMEX');
});

test('AAOI opens the bStock for Spot and the perpetual for Futures from either scanner ticker', () => {
  const {url} = workspace();
  for (const pair of ['AAOI', 'AAOIUSDT', 'AAOIBUSDT']) {
    assert.equal(new URL(url(pair, 'SPOT')).searchParams.get('symbol'), 'BINANCE:AAOIBUSDT');
    assert.equal(new URL(url(pair, 'FUTURES')).searchParams.get('symbol'), 'BINANCE:AAOIUSDT.P');
  }
});

test('the AAOI stock opens the qualified Nasdaq instrument with Colmex', () => {
  const {stockUrl} = workspace();
  assert.deepEqual(Object.fromEntries(new URL(stockUrl('NASDAQ:AAOI')).searchParams),
    {symbol: 'NASDAQ:AAOI', interval: '5', 'trade-now': 'COLMEX'});
  for (const symbol of ['AAOI', 'BINANCE:AAOIBUSDT', 'NASDAQ:AAOI&order=buy', 'NASDAQ:', null]) {
    assert.equal(stockUrl(symbol), null);
  }
});

test('requires a Binance pair and an explicit market and discards invalid saved layouts', () => {
  const {url} = workspace('https://example.org/chart/MyLayout1/');
  for (const invalid of ['NASDAQ:AAOI', 'AAPL', 'USDT', 'BINANCE:BTCUSDT', 'BTCUSDT.P', '', null, {}, 'BTCUSDT&side=buy']) {
    assert.equal(url(invalid, 'SPOT'), null);
  }
  for (const market of [null, undefined, 'STOCK', 'futures']) {
    assert.equal(url('BTCUSDT', market), null);
  }
  assert.equal(new URL(url('1000PEPEUSDT', 'FUTURES')).pathname, '/chart/SjakpoXv/');
});
