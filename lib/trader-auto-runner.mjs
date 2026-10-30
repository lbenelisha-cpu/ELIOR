import {PAPER_MARKETS, newPaperState, checkPaperState, processPaperSymbol, paperDecision, expirePaperSignals} from './trader-auto-paper.mjs';
import {marketHours} from './colmex-market-hours.mjs';

const safeErrors = new Set(['INVALID_MARKET_DATA', 'MARKET_DATA_GAP', 'STALE_MARKET_DATA', 'WAIT_MA_HISTORY',
  'MARKET_RATE_LIMIT', 'MARKET_UNAVAILABLE', 'CYCLE_DEADLINE', 'STOCK_SOURCE_NOT_CONFIGURED']);
const errorCode = e => safeErrors.has(e?.message) ? e.message : 'MARKET_UNAVAILABLE';

export async function runPaperPlatform({platform, store, readMarket, research, now = Date.now(), clock = Date.now,
  deadline = now + 25000, enabled = true, signalEvaluator}) {
  const key = platform.toLowerCase(), stored = await store.getWithMetadata(key, {type: 'json'});
  const state = stored ? structuredClone(stored.data) : newPaperState(platform, now);
  checkPaperState(state, platform);
  const cycle = Math.floor(now / 300000);
  if (state.lastCycle !== null && state.lastCycle >= cycle) return {reason: 'ALREADY_PROCESSED', platform};
  state.lastCycle = cycle;
  expirePaperSignals(state, now);
  const hours = platform === 'COLMEX' ? marketHours(now) : {known: true, open: true};
  const recentlyOpen = platform === 'COLMEX' && marketHours(now - 300000).open;
  if (!hours.known || !hours.open && !recentlyOpen) {
    state.status = hours.known ? 'MARKET_CLOSED' : 'CALENDAR_UNAVAILABLE';
  } else {
    const watched = PAPER_MARKETS[platform].symbols;
    const mandatory = [...new Set([...Object.keys(state.positions), ...Object.keys(state.pending)])];
    const candidates = enabled ? [watched[state.rotation % watched.length], watched[(state.rotation + 1) % watched.length]] : [];
    state.rotation = (state.rotation + 2) % watched.length;
    const selected = [...new Set([...mandatory, ...candidates])];
    const results = await Promise.allSettled(selected.map(async symbol => {
      if (clock() > deadline - 14500) throw Error('CYCLE_DEADLINE');
      return readMarket(platform, symbol, now);
    }));
    const rows = new Map(); let failures = 0;
    for (let i = 0; i < selected.length; i++) {
      const symbol = selected[i], result = results[i];
      if (result.status === 'fulfilled') rows.set(symbol, result.value);
      else {failures++; paperDecision(state, symbol, errorCode(result.reason), now);}
    }
    // Exits first, then entries. An unavailable holding blocks new purchases even
    // if its last stored mark still falls within the age window.
    let holdingFailure = Object.keys(state.positions).some(symbol => !rows.has(symbol));
    for (const symbol of Object.keys(state.positions)) {
      if (!rows.has(symbol)) continue;
      try {processPaperSymbol(state, symbol, rows.get(symbol), now, {allowEntry: false});}
      catch (error) {holdingFailure = true; failures++; paperDecision(state, symbol, errorCode(error), now);}
      rows.delete(symbol);
    }
    const newSignals = [];
    for (const [symbol, bars] of rows) {
      const wasPending = !!state.pending[symbol];
      try {
        processPaperSymbol(state, symbol, bars, now, {allowEntry: enabled && !holdingFailure, signalEvaluator});
        if (!wasPending && state.pending[symbol]) newSignals.push(symbol);
      } catch (error) {failures++; paperDecision(state, symbol, errorCode(error), now);}
    }
    // Context is informational. Its absence NEVER becomes a positive signal.
    // Bound research work and preserve the pending signal if a source is down.
    await Promise.all(newSignals.map(async symbol => {
      let context = {news: {status: 'NOT_FETCHED', data: []}, financials: {status: platform === 'BINANCE' ? 'NOT_APPLICABLE' : 'NOT_FETCHED', data: null}};
      if (research && clock() < deadline - 9500) {
        try {context = await research(platform, symbol);} catch {context.news.status = 'UNAVAILABLE';}
      }
      state.pending[symbol].research = context;
      const signal = state.journal.findLast(item => item.type === 'SIGNAL' && item.symbol === symbol);
      if (signal) signal.research = context;
    }));
    state.status = failures ? 'PARTIAL_DATA' : enabled ? 'RUNNING' : 'ENTRY_PAUSED';
    const good = selected.map(symbol => state.decisions[symbol]?.dataAt).filter(Number.isFinite);
    if (good.length) state.lastDataAt = Math.max(...good);
  }
  state.lastCompletedAt = clock();
  // Optimistic transaction: only one concurrent run can commit this paper cycle.
  const saved = await store.setJSON(key, state, stored ? {onlyIfMatch: stored.etag} : {onlyIfNew: true});
  return {platform, reason: saved.modified ? 'SAVED' : 'CONCURRENT_CYCLE_DISCARDED', status: state.status};
}
