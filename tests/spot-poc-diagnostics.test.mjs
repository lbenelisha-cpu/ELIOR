import test from 'node:test';
import assert from 'node:assert/strict';
import { spotPocDiagnostics } from '../spot-poc-diagnostics.mjs';

const entryAt = '2026-11-14T10:00:00.000Z';
const closeAt = '2026-11-14T10:45:00.000Z';
const peakAt = '2026-11-14T10:25:00.000Z';
const version = 'BINANCE_CHANNEL_POC_RETEST_V2';
const entryMode = 'channel_breakout';

function sell(symbol, overrides = {}) {
  return {
    symbol, entryAt, entryMode, entryPolicyVersion: version,
    at: closeAt, entryPrice: 100, sellPrice: 99, closed: true,
    costUsdt: 100, netPnlUsdt: -1, feesComplete: true,
    peakPrice: 100, reason: 'BROKER_STOP_LOSS', ...overrides
  };
}

function buy(symbol, changes = {}, meta = {}) {
  const swingProtection = {
    side: 'LONG', version: 'FIVE_CONFIRMED_SWINGS_V1', timeframe: '5m',
    status: 'ACTIVE', at: Date.parse(entryAt) - 400, gapPct: 2,
    waves: Array.from({length: 5}, (_, i) => ({
      pct: 2, from: i * 6000000, to: i * 6000000 + 3000000,
      fromPrice: 100, toPrice: 102, confirmedAt: i * 6000000 + 3600000
    }))
  };
  return {
    type: 'BUY', mode: 'live', status: 'FILLED', symbol, at: entryAt, price: 100, qty: 1,
    amountUsdt: 100, commissions: [], orderId: symbol + ':entry', ...changes,
    wyckoffTrade: {entryMode, entryPolicyVersion: version, swingProtection, entryPrice: 100,
      peakPrice: 100, peakAt: entryAt, ...meta}
  };
}

function report(rows, buys = [], others = {}) {
  return spotPocDiagnostics({ mode: 'live', ...others, netJournal: {live: rows}, live: buys });
}

test('uses fully closed POC V2 Spot positions; weights partial sell costs before normalizing', () => {
  const result = report([
    sell('SOLUSDT', {costUsdt: 70, netPnlUsdt: -1.4, reason: 'TRAIL_STOP_LOSS_1_PERCENT'}),
    sell('SOLUSDT', {at: peakAt, closed: false, costUsdt: 30, netPnlUsdt: 0.6, reason: 'MANUAL_SELL'}),
    sell('ETHUSDT', {costUsdt: 25, netPnlUsdt: 0.5}),
    sell('BNBUSDT', {netPnlUsdt: 0}),
    sell('OLDUSDT', {entryPolicyVersion: 'BINANCE_CHANNEL_POC_RETEST_V1'}),
    sell('MANUSDT', {entryMode: 'manual_external'}),
    sell('PARTUSDT', {closed: false})
  ]);
  assert.equal(result.counts.closed, 3);
  assert.equal(result.counts.verified, 3);
  assert.deepEqual([result.counts.wins, result.counts.losses, result.counts.flat], [1, 1, 1]);
  const loss = result.trades.find(x => x.symbol === 'SOLUSDT');
  assert.equal(loss.reason, 'TRAIL_STOP_LOSS_1_PERCENT');
  assert.equal(loss.cost, 100);
  assert.ok(Math.abs(loss.returnPct + 0.8) < 1e-9);
  assert.equal(result.winners.avgReturnPct, 2);
  assert.equal(result.winners.avgCost, 25);
});

test('incomplete partial-leg fees never contribute to win/loss or normalized returns', () => {
  const result = report([
    sell('SOLUSDT', {feesComplete: true, netPnlUsdt: 3}),
    sell('SOLUSDT', {at: peakAt, closed: false, costUsdt: 25, feesComplete: false, netPnlUsdt: null})
  ]);
  assert.equal(result.counts.closed, 1);
  assert.equal(result.counts.unknown, 1);
  assert.equal(result.counts.wins + result.counts.losses + result.counts.flat, 0);
  assert.equal(result.trades[0].net, null);
  assert.equal(result.trades[0].returnPct, null);
});

test('a second entry in the same symbol never supplies protection evidence to an older position', () => {
  const otherAt = '2026-11-14T12:00:00.000Z';
  const result = report([sell('SOLUSDT', {reason: 'TRAILING_PROFIT_EXIT'})], [
    buy('SOLUSDT', {at: otherAt}, {profitFloorArmed: true, peakPrice: 103})
  ]);
  assert.equal(result.trades[0].wave, 'unknown');
});

test('classifies actual exit reasons only in the presence of a valid five-wave entry snapshot', () => {
  const result = report([
    sell('ETHUSDT', {reason: 'TRAILING_PROFIT_EXIT'}),
    sell('SOLUSDT', {reason: 'TRAIL_STOP_LOSS_1_PERCENT'}),
    sell('BNBUSDT', {reason: 'BROKER_STOP_LOSS'}),
    sell('OLDUSDT', {reason: 'TRAIL_STOP_LOSS_1_PERCENT'}),
    sell('FALLUSDT', {reason: 'TRAILING_PROFIT_EXIT'})
  ], [
    buy('ETHUSDT'), buy('SOLUSDT'), buy('BNBUSDT'),
    buy('FALLUSDT', {}, {swingProtection: {version:'FIVE_CONFIRMED_SWINGS_V1', status:'FALLBACK', waves:[]}})
  ]);
  assert.equal(result.trades.find(x => x.symbol === 'ETHUSDT').wave, 'armed');
  assert.equal(result.trades.find(x => x.symbol === 'SOLUSDT').wave, 'not_armed');
  for (const symbol of ['BNBUSDT', 'OLDUSDT', 'FALLUSDT']) {
    assert.equal(result.trades.find(x => x.symbol === symbol).wave, 'unknown');
  }
});

test('pre-exit observed peak can establish a reached frozen threshold, but a peak after exit cannot', () => {
  const result = report([sell('SOLUSDT'), sell('ETHUSDT')], [
    buy('SOLUSDT', {}, {peakAt, peakPrice: 102}),
    buy('ETHUSDT', {}, {peakAt: '2026-11-14T11:00:00.000Z', peakPrice: 104})
  ]);
  const reached = result.trades.find(x => x.symbol === 'SOLUSDT');
  assert.equal(reached.activationPrice, 102);
  assert.equal(reached.wave, 'threshold_reached');
  assert.equal(reached.waveEvidence, 'OBSERVED_PRE_EXIT_PEAK');
  assert.equal(result.trades.find(x => x.symbol === 'ETHUSDT').wave, 'unknown');
  assert.deepEqual([result.counts.armed, result.counts.notArmed, result.counts.thresholdReached, result.counts.unknownWave], [0, 0, 1, 1]);
});

test('persisted activation takes precedence over price evidence, and a missing snapshot remains unknown', () => {
  const result = report([sell('ETHUSDT'), sell('SOLUSDT')], [
    buy('ETHUSDT', {}, {profitFloorArmed: true, peakAt, peakPrice: 103}),
    buy('SOLUSDT', {}, {swingProtection: null, profitFloorArmed: true})
  ]);
  const armed = result.trades.find(x => x.symbol === 'ETHUSDT');
  assert.equal(armed.wave, 'armed');
  assert.equal(armed.waveEvidence, 'PERSISTED_ARMED_STATE');
  const unknown = result.trades.find(x => x.symbol === 'SOLUSDT');
  assert.equal(unknown.wave, 'unknown');
  assert.equal(unknown.waveEvidence, 'NO_VALID_WAVES');
  assert.deepEqual([result.counts.armed, result.counts.thresholdReached, result.counts.unknownWave], [1, 0, 1]);
});

test('conflicting saved peak and unarmed exit reason keep the evidence unknown', () => {
  const result = report([sell('SOLUSDT', {reason: 'TRAIL_STOP_LOSS_1_PERCENT'})], [
    buy('SOLUSDT', {}, {peakAt, peakPrice: 103})
  ]);
  assert.equal(result.trades[0].wave, 'unknown');
  assert.equal(result.trades[0].waveEvidence, 'CONFLICTING_EVIDENCE');
});

test('excludes a position that became mixed after its first partial sale', () => {
  const result = report([
    sell('SOLUSDT', {entryMode: 'mixed_or_multiple_entries', entryPolicyVersion: null}),
    sell('SOLUSDT', {at: peakAt, closed: false})
  ], [buy('SOLUSDT')]);
  assert.equal(result.counts.closed, 0);
});

test('requires the five-wave snapshot timestamp to be recorded by entry time', () => {
  for (const invalid of [undefined, null, 0, Date.parse(closeAt)]) {
    const entry = buy('SOLUSDT');
    entry.wyckoffTrade.swingProtection.at = invalid;
    const result = report([sell('SOLUSDT', {reason: 'TRAILING_PROFIT_EXIT'})], [entry]);
    assert.equal(result.trades[0].wave, 'unknown');
  }
});
