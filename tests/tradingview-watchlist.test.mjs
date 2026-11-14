import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { COLMEX_WATCH_SYMBOLS } from '../lib/colmex-watch-universe.mjs';

test('the TradingView import covers every Colmex watch symbol once in scanner order', () => {
  const text = readFileSync(new URL('../tradingview/LEVI-Colmex-50.txt', import.meta.url), 'utf8');
  const qualified = text.trim().split(',');
  for (const symbol of qualified) assert.match(symbol, /^(NASDAQ|NYSE):[A-Z]+$/);
  assert.deepEqual(qualified.map(symbol => symbol.split(':')[1]), [...COLMEX_WATCH_SYMBOLS]);
  assert.equal(new Set(qualified).size, qualified.length);
});
