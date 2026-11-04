// POC reclaim rules ported from the Binance POC paper strategy.
// This module only evaluates market data; order execution remains in the live runner.
export const POC_LIVE_POLICY = Object.freeze({
  version: 'POC_LIVE_V1',
  lookback: 50,
  pivotBars: 2,
  profileRows: 24,
  expiryMs: 300000,
  trailingPct: 1,
  quoteMaxAgeMs: 10000,
  gapMs: 15000,
  slots: {LONG: 5, SHORT: 2}
});

const MINUTE = 60000;
const FIVE = 300000;
const validNumber = x => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x));

export function parsePocMinuteBars(raw, now) {
  if (!Array.isArray(raw)) throw Error('POC_HISTORY_UNAVAILABLE');
  const rows = raw.map(r => ({
    at: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]),
    close: Number(r[4]), volume: Number(r[5]), end: Number(r[6]) + 1
  }));
  if (rows.some(r => !Object.values(r).every(Number.isFinite) || r.at % MINUTE ||
    r.end !== r.at + MINUTE || r.volume < 0 || r.low <= 0 ||
    r.high < Math.max(r.open, r.close) || r.low > Math.min(r.open, r.close))) {
    throw Error('POC_HISTORY_INVALID');
  }
  const closed = rows.filter(r => r.end <= now);
  if (closed.some((r, i) => i && r.at <= closed[i - 1].at)) throw Error('POC_HISTORY_INVALID');
  return closed;
}

export function pocVolumePoint(rows, side) {
  if (!Array.isArray(rows) || !rows.length || !['LONG', 'SHORT'].includes(side)) return null;
  const low = Math.min(...rows.map(r => r.low));
  const high = Math.max(...rows.map(r => r.high));
  const width = (high - low) / POC_LIVE_POLICY.profileRows;
  const volumes = Array(POC_LIVE_POLICY.profileRows).fill(0);
  if (!(width > 0) || !rows.some(r => r.volume > 0)) return null;
  for (const r of rows) {
    if (r.high === r.low) {
      const k = Math.min(volumes.length - 1, Math.max(0, Math.floor((r.low - low) / width)));
      volumes[k] += r.volume;
    } else {
      for (let k = 0; k < volumes.length; k++) {
        const a = low + k * width, b = a + width;
        volumes[k] += r.volume * Math.max(0, Math.min(b, r.high) - Math.max(a, r.low)) / (r.high - r.low);
      }
    }
  }
  const max = Math.max(...volumes);
  const ties = volumes.flatMap((v, k) => Math.abs(v - max) <= 1e-9 + 1e-10 * Math.abs(max) ? [k] : []);
  const k = side === 'LONG' ? ties.at(-1) : ties[0];
  return low + (k + 0.5) * width;
}

export function findPocLiveSetup(raw, symbol, side, now) {
  if (!['LONG', 'SHORT'].includes(side) || typeof symbol !== 'string') throw Error('POC_INVALID_MARKET');
  const minutes = parsePocMinuteBars(raw, now);
  const lastEnd = Math.floor(now / FIVE) * FIVE;
  const window = minutes.filter(r => r.at >= lastEnd - 50 * FIVE && r.end <= lastEnd);
  if (window.length !== 250 || window[0].at !== lastEnd - 50 * FIVE || window.at(-1).end !== lastEnd ||
    window.some((r, i) => i && r.at !== window[i - 1].end)) throw Error('POC_HISTORY_GAP');

  const bars = [];
  for (let i = 0; i < 250; i += 5) {
    const m = window.slice(i, i + 5);
    bars.push({at: m[0].at, end: m.at(-1).end, high: Math.max(...m.map(r => r.high)),
      low: Math.min(...m.map(r => r.low)), close: m.at(-1).close});
  }
  let sequence = [], latest = null;
  for (let i = 4; i < bars.length; i++) {
    const k = i - 2, b = bars[k], neighbors = [k - 2, k - 1, k + 1, k + 2];
    const isHigh = neighbors.every(j => b.high > bars[j].high);
    const isLow = neighbors.every(j => b.low < bars[j].low);
    if (isHigh === isLow) continue;
    const pivot = {i: k, at: b.at, kind: isHigh ? 'H' : 'L', price: isHigh ? b.high : b.low};
    let changed = false;
    if (sequence.at(-1)?.kind === pivot.kind) {
      if (isHigh ? pivot.price > sequence.at(-1).price : pivot.price < sequence.at(-1).price) {
        sequence[sequence.length - 1] = pivot; changed = true;
      }
    } else { sequence.push(pivot); changed = true; }
    if (!changed || sequence.length < 4) continue;
    const four = sequence.slice(-4), kinds = four.map(p => p.kind).join('');
    const direction = kinds === 'LHLH' && four[2].price > four[0].price && four[3].price > four[1].price ? 'LONG' :
      kinds === 'HLHL' && four[2].price < four[0].price && four[3].price < four[1].price ? 'SHORT' : null;
    if (direction !== side) continue;
    const profileBars = window.filter(r => r.at >= four[2].at && r.end <= bars[four[3].i].end);
    const poc = pocVolumePoint(profileBars, side);
    if (poc) latest = {
      id: [symbol, side, ...four.map(p => p.at)].join(':'), symbol, side,
      poc, structuralStop: four[2].price, pivots: four,
      trailingPct: POC_LIVE_POLICY.trailingPct,
      confirmedAt: bars[i].end, expiresAt: lastEnd + POC_LIVE_POLICY.expiryMs,
      historyAt: lastEnd
    };
  }
  if (!latest || latest.expiresAt <= now) return null;
  const later = bars.filter(b => b.end > latest.confirmedAt);
  if (later.some(b => side === 'LONG' ? b.low <= latest.structuralStop : b.high >= latest.structuralStop)) return null;
  return latest;
}

export function verifiedPocQuote(raw, now) {
  if (!raw || ![raw.bid, raw.ask, raw.at].every(validNumber)) return null;
  const quote = {bid: Number(raw.bid), ask: Number(raw.ask), at: Number(raw.at)};
  return quote.bid > 0 && quote.ask >= quote.bid && quote.at <= now + 1000 &&
    now - quote.at <= POC_LIVE_POLICY.quoteMaxAgeMs ? quote : null;
}

// Returns only state transitions. The caller persists them before submitting any order.
export function pocQuoteTransition(setup, state, rawQuote, now) {
  if (!setup || setup.expiresAt <= now) return {action: 'EXPIRE'};
  const quote = verifiedPocQuote(rawQuote, now);
  if (!quote) return {action: state?.armed ? 'DISARM' : 'WAIT_FRESH_QUOTE'};
  const sign = setup.side === 'LONG' ? 1 : -1;
  const observed = setup.side === 'LONG' ? quote.bid : quote.ask;
  if (sign * (observed - setup.structuralStop) <= 0) return {action: 'INVALIDATE', quote, observed};
  if (sign * (observed - setup.poc) < 0) return {action: state?.armed ? 'HOLD_ARMED' : 'ARM', quote, observed};
  if (state?.armed && sign * (observed - setup.poc) > 0) {
    if (quote.at - Number(state.armedAt || 0) > POC_LIVE_POLICY.gapMs) return {action: 'DISARM', quote, observed};
    return {action: 'ENTER', quote, observed};
  }
  return {action: 'WAIT_RECLAIM', quote, observed};
}
