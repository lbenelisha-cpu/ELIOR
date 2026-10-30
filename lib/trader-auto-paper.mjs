import {qualityEntry, assertQualityEntry, qualityMeasures} from './confirmed-entry-quality.mjs';
import {sizeRisk} from './confirmed-risk-sizing.mjs';
import {DEFAULT_TRADE_SETTINGS} from './trade-settings.mjs';
import {applyTrailingExitPolicy} from './trailing-profit-exit.mjs';
import {binancePositionExit} from './binance-position-exit.mjs';
import {stockSessionGap} from './colmex-market-hours.mjs';

// A separate, fictional ledger. This module has no broker, order or account API.
export const PAPER_VERSION = 'TRADER_AUTO_PAPER_V1';
export const PAPER_POLICY = Object.freeze({seed: 10000, maxPositions: 5, allocationPct: 20,
  feePctPerSide: 0.1, scanMinutes: 5, maxDataAgeMs: 420000, journalLimit: 300,
  fillModel: 'NEXT_OBSERVED_CLOSED_BAR', settings: DEFAULT_TRADE_SETTINGS});
export const PAPER_MARKETS = Object.freeze({
  BINANCE: {currency: 'USDT', source: 'Binance public 5m candles', symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT']},
  COLMEX: {currency: 'USD', source: 'Twelve Data 5m candles (not Colmex quotes)', symbols: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL']}
});
const positive = n => Number.isFinite(n) && n > 0;
export function newPaperState(platform, now) {
  if (!PAPER_MARKETS[platform]) throw Error('INVALID_PLATFORM');
  return {version: PAPER_VERSION, mode: 'PAPER_ONLY', platform, currency: PAPER_MARKETS[platform].currency,
    startedAt: now, cash: PAPER_POLICY.seed, realizedPnl: 0, fees: 0, buys: 0, sells: 0,
    positions: {}, pending: {}, boundary: {}, decisions: {}, journal: [], journalTotal: 0,
    rotation: 0, lastCycle: null, lastCompletedAt: null, lastDataAt: null, status: 'WAIT_FIRST_SCAN'};
}
export function checkPaperState(state, platform) {
  if (state?.version !== PAPER_VERSION || state.mode !== 'PAPER_ONLY' || state.platform !== platform ||
      !Number.isFinite(state.cash) || state.cash < -1e-8 || !state.positions || !state.pending || !state.decisions)
    throw Error('PAPER_STATE_INVALID');
}
export function paperSummary(state) {
  const positions = Object.values(state.positions);
  const marketValue = positions.reduce((sum, p) => sum + p.quantity * p.lastPrice, 0);
  const equity = state.cash + marketValue;
  return {cash: state.cash, equity, marketValue, pnl: equity - PAPER_POLICY.seed,
    realizedPnl: state.realizedPnl, unrealizedPnl: positions.reduce((sum, p) => sum + p.quantity * p.lastPrice - p.cost, 0),
    fees: state.fees, buys: state.buys, sells: state.sells, openPositions: positions.length};
}
function record(state, item) {
  state.journal.push({id: ++state.journalTotal, ...item});
  state.journal = state.journal.slice(-PAPER_POLICY.journalLimit);
}
export function paperDecision(state, symbol, reason, now, details = {}) {
  state.decisions[symbol] = {symbol, reason, checkedAt: now, ...details};
}
export function validatePaperBars(bars, platform, now) {
  if (!Array.isArray(bars) || bars.length < 204) throw Error('WAIT_MA_HISTORY');
  const gapAllowed = platform === 'COLMEX' ? stockSessionGap : () => false;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], prev = bars[i - 1];
    if (![b.open, b.high, b.low, b.close].every(positive) || !Number.isFinite(b.volume) || b.volume < 0 ||
        b.low > Math.min(b.open, b.close) || b.high < Math.max(b.open, b.close) || b.low > b.high ||
        !Number.isInteger(b.openTime) || b.openTime % 300000 !== 0 || b.closeTime !== b.openTime + 300000 ||
        b.closeTime > now || b.closed === false) throw Error('INVALID_MARKET_DATA');
    if (prev && b.closeTime !== prev.closeTime + 300000 && !gapAllowed(prev.closeTime, b.closeTime)) throw Error('MARKET_DATA_GAP');
  }
  if (now - bars.at(-1).closeTime > PAPER_POLICY.maxDataAgeMs) throw Error('STALE_MARKET_DATA');
  return bars.at(-1);
}
function evaluate(bars, state, symbol) {
  const latest = bars.at(-1), at = latest.closeTime;
  return qualityEntry(bars, at, Math.max(state.startedAt, state.boundary[symbol] || 0), [],
    {price: latest.close, priceAsOf: at}, {ready: false, reason: 'WAIT_CLOSED_CONFIRMATION'},
    {platform: state.platform, isSessionGap: state.platform === 'COLMEX' ? stockSessionGap : () => false});
}
function cancel(state, symbol, reason, now, dataAt) {
  const pending = state.pending[symbol];
  record(state, {type: 'CANCEL', symbol, reason, at: now, dataAt, signalTime: pending.setup.signalTime});
  delete state.pending[symbol];
  paperDecision(state, symbol, reason, now, {dataAt});
}
export function expirePaperSignals(state, now) {
  for (const [symbol, pending] of Object.entries(state.pending)) {
    if (now >= pending.setup.signalExpiresAt) cancel(state, symbol, 'SIGNAL_EXPIRED', now, null);
  }
}
// Call once per cycle after ALL held assets were refreshed. Entry checks therefore
// cannot size against a portfolio where one held asset has a stale valuation.
export function processPaperSymbol(state, symbol, bars, now, {allowEntry = true, signalEvaluator = evaluate} = {}) {
  checkPaperState(state, state.platform);
  if (!PAPER_MARKETS[state.platform].symbols.includes(symbol)) throw Error('INVALID_SYMBOL');
  const last = validatePaperBars(bars, state.platform, now), price = last.close, at = last.closeTime;
  const held = state.positions[symbol];
  if (held) {
    held.lastPrice = price; held.priceAt = at;
    if (at <= held.exitCheckedAt) return;
    const exit = binancePositionExit(held, price, at); held.exitCheckedAt = at;
    if (exit.sell) {
      const proceeds = held.quantity * price, fee = proceeds * PAPER_POLICY.feePctPerSide / 100;
      const pnl = proceeds - fee - held.cost;
      state.cash += proceeds - fee; state.fees += fee; state.realizedPnl += pnl; state.sells++;
      state.boundary[symbol] = Math.max(now, state.boundary[symbol] || 0);
      record(state, {type: 'SELL', symbol, at: now, dataAt: at, price, quantity: held.quantity, fee, pnl,
        reason: exit.reason.replace('BROKER_', 'PAPER_'), entryAt: held.entryAt});
      delete state.positions[symbol];
    }
    paperDecision(state, symbol, exit.reason.replace('BROKER_', 'PAPER_'), now, {dataAt: at, action: exit.sell ? 'SELL' : 'HOLD'});
    return;
  }
  const pending = state.pending[symbol];
  if (pending) {
    if (now >= pending.setup.signalExpiresAt) {cancel(state, symbol, 'SIGNAL_EXPIRED', now, at); return;}
    if (!allowEntry) {paperDecision(state, symbol, 'ENTRY_PAUSED', now, {dataAt: at}); return;}
    if (at <= pending.observedAt) {paperDecision(state, symbol, 'WAIT_NEXT_CLOSED_BAR', now, {dataAt: at}); return;}
    try {
      assertQualityEntry(pending.setup, price, at);
      const low = pending.setup.springLow?.price ?? pending.setup.waveLow?.price;
      if (bars.some(b => b.closeTime > pending.setup.signalTime && (b.low < low ||
          pending.setup.entryMode === 'spring_reclaim_confirmed' && b.high >= pending.setup.initialPeak.price))) throw Error('QUALITY_SIGNAL_INVALIDATED');
    } catch (error) {cancel(state, symbol, error.message, now, at); return;}
    const confirmationIndex = bars.findIndex(b => b.closeTime === pending.setup.signalTime);
    const measures = qualityMeasures(bars, confirmationIndex, price);
    if (!measures.trend.ready || measures.trend.blocked || !measures.volume.ready || measures.volume.ratio < 1 || !positive(measures.atr)) {
      cancel(state, symbol, 'QUALITY_FILTER_CHANGED', now, at); return;
    }
    if (Object.keys(state.positions).length >= PAPER_POLICY.maxPositions) {cancel(state, symbol, 'MAX_POSITIONS', now, at); return;}
    const staleHolding = Object.values(state.positions).some(p => now - p.priceAt > PAPER_POLICY.maxDataAgeMs);
    if (staleHolding) {paperDecision(state, symbol, 'WAIT_PORTFOLIO_PRICES', now, {dataAt: at}); return;}
    const feeRate = PAPER_POLICY.feePctPerSide / 100;
    // Both entry fee and estimated exit fee fit inside the cash/allocation budget.
    const amount = Math.max(0, Math.min(state.cash, paperSummary(state).equity * PAPER_POLICY.allocationPct / 100) / (1 + 2 * feeRate));
    const risk = sizeRisk(price, amount, PAPER_POLICY.settings, {...pending.riskInput, atr: measures.atr});
    if (risk.reason !== 'READY') {cancel(state, symbol, risk.reason, now, at); return;}
    // Include estimated round-trip costs in the virtual risk budget (8 units max).
    const budget = Math.min(risk.budget, risk.riskPlan.riskBudgetUsd / (risk.settings.stopLossPct / 100 + 2 * feeRate));
    const quantity = state.platform === 'COLMEX' ? Math.floor(budget / price) : Math.floor(budget / price * 1e8) / 1e8;
    const notional = quantity * price, fee = notional * feeRate, cost = notional + fee;
    if (!(quantity > 0) || cost > state.cash || !Number.isFinite(cost)) {cancel(state, symbol, 'INSUFFICIENT_PAPER_CASH', now, at); return;}
    const position = {symbol, strategyId: 'WYCKOFF_5M_V1', entryAt: now, entryPrice: price, quantity, cost,
      lastPrice: price, priceAt: at, exitCheckedAt: at, peakPrice: price, riskPlan: risk.riskPlan,
      signalTime: pending.setup.signalTime, entryMode: pending.setup.entryMode, research: pending.research || null};
    applyTrailingExitPolicy(position, risk.settings);
    state.positions[symbol] = position; state.cash -= cost; state.fees += fee; state.buys++;
    delete state.pending[symbol];
    record(state, {type: 'BUY', symbol, at: now, dataAt: at, price, quantity, fee, reason: pending.setup.entryMode,
      signalTime: pending.setup.signalTime, observedAt: pending.observedAt, riskPlan: risk.riskPlan, research: position.research});
    paperDecision(state, symbol, 'PAPER_BUY', now, {dataAt: at, action: 'BUY'});
    return;
  }
  if (!allowEntry) {paperDecision(state, symbol, 'ENTRY_PAUSED', now, {dataAt: at}); return;}
  if (Object.keys(state.positions).length + Object.keys(state.pending).length >= PAPER_POLICY.maxPositions) {
    paperDecision(state, symbol, 'MAX_POSITIONS', now, {dataAt: at}); return;
  }
  const signal = signalEvaluator(bars, state, symbol);
  paperDecision(state, symbol, signal.reason, now, {dataAt: at, quality: signal.quality || null});
  if (!signal.ready) return;
  if (!(signal.setup.signalTime > Math.max(state.startedAt, state.boundary[symbol] || 0)) ||
      signal.setup.signalTime > at || now >= signal.setup.signalExpiresAt) return;
  state.pending[symbol] = {setup: signal.setup, riskInput: signal.riskInput, observedAt: now};
  state.boundary[symbol] = signal.setup.signalTime;
  record(state, {type: 'SIGNAL', symbol, at: now, dataAt: at, signalTime: signal.setup.signalTime, reason: signal.setup.entryMode});
  paperDecision(state, symbol, 'WAIT_NEXT_CLOSED_BAR', now, {dataAt: at});
}
