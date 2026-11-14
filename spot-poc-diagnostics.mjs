import { frozenSwingActivation } from './lib/swing-profit-protection.mjs';

const POLICY = 'BINANCE_CHANNEL_POC_RETEST_V2';
const entryKey = (symbol, at) => symbol + '|' + at;
const isCohort = row => row?.entryMode === 'channel_breakout' && row.entryPolicyVersion === POLICY;
const positive = n => Number.isFinite(n) && n > 0;
const timeOf = at => typeof at === 'number' ? at : typeof at === 'string' ? Date.parse(at) : NaN;
const mean = (rows, field) => rows.length ? rows.reduce((sum, row) => sum + row[field], 0) / rows.length : null;

function groupStats(rows) {
  return { count: rows.length, avgCost: mean(rows, 'cost'), avgReturnPct: mean(rows, 'returnPct'), avgNet: mean(rows, 'net') };
}

function waveState(buy, final) {
  const observed = { wave: 'unknown', waveEvidence: 'BUY_UNAVAILABLE', activationPrice: null, activationPct: null, peakPrice: null };
  if (!buy || !isCohort(buy.wyckoffTrade)) return observed;
  const position = buy.wyckoffTrade;
  const snapshot = position.swingProtection || position.setup?.swingProtection;
  const pct = frozenSwingActivation(position);
  if (snapshot?.timeframe !== '5m' || pct === null || !positive(snapshot.at) || snapshot.at > timeOf(final.entryAt)) {
    return { ...observed, waveEvidence: snapshot?.status === 'FALLBACK' ? 'FALLBACK' : 'NO_VALID_WAVES' };
  }
  const entry = final.entryPrice;
  if (!positive(entry)) return { ...observed, waveEvidence: 'ENTRY_PRICE_UNKNOWN' };
  observed.activationPct = pct;
  observed.activationPrice = entry * (1 + pct / 100);
  const peakAt = timeOf(position.peakAt);
  if (positive(position.peakPrice) && peakAt >= timeOf(final.entryAt) && peakAt < timeOf(final.at)) {
    observed.peakPrice = position.peakPrice;
  }
  const crossed = observed.peakPrice !== null && observed.peakPrice >= observed.activationPrice;
  const explicitUnarmed = /^TRAIL_STOP_LOSS_\d+(?:\.\d+)?_PERCENT$/.test(final.reason);
  if (explicitUnarmed && (crossed || position.profitFloorArmed === true)) {
    return { ...observed, waveEvidence: 'CONFLICTING_EVIDENCE' };
  }
  if (explicitUnarmed) return { ...observed, wave: 'not_armed', waveEvidence: 'UNARMED_STOP_REASON' };
  if (final.reason === 'TRAILING_PROFIT_EXIT') return { ...observed, wave: 'armed', waveEvidence: 'TRAILING_EXIT_REASON' };
  // The retained BUY flag is written only while this exact entry is an open managed position.
  // There is no symmetric, authoritative final "false" for a native/broker stop.
  if (position.profitFloorArmed === true) return { ...observed, wave: 'armed', waveEvidence: 'PERSISTED_ARMED_STATE' };
  if (crossed) return { ...observed, wave: 'threshold_reached', waveEvidence: 'OBSERVED_PRE_EXIT_PEAK' };
  return { ...observed, waveEvidence: 'INCOMPLETE_PEAK_HISTORY' };
}

export function spotPocDiagnostics(log) {
  const groups = new Map();
  for (const row of Array.isArray(log?.netJournal?.live) ? log.netJournal.live : []) {
    if (typeof row?.symbol !== 'string' || !row.symbol || !Number.isFinite(timeOf(row.entryAt))) continue;
    const key = entryKey(row.symbol, row.entryAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const buys = new Map();
  for (const action of Array.isArray(log?.live) ? log.live : []) {
    if (action?.type !== 'BUY') continue;
    const key = entryKey(action.symbol, action.at);
    // Duplicate or ambiguous BUY records must not supply state for these positions.
    buys.set(key, buys.has(key) ? null : action);
  }
  const trades = [];
  for (const [key, legs] of groups) {
    if (!legs.every(isCohort)) continue;
    if (legs.some(leg => !Number.isFinite(timeOf(leg.at)) || timeOf(leg.at) < timeOf(leg.entryAt))) continue;
    // Source is newest-first; reverse before the stable sort to retain same-time fill order.
    legs.reverse().sort((a, b) => timeOf(a.at) - timeOf(b.at));
    const final = legs.at(-1);
    if (final.closed !== true || legs.slice(0,-1).some(leg => leg.closed !== false)) continue;
    const verified = legs.every(leg => leg.feesComplete === true && positive(leg.costUsdt) && Number.isFinite(leg.netPnlUsdt));
    const cost = verified ? legs.reduce((sum, leg) => sum + leg.costUsdt, 0) : null;
    const net = verified ? legs.reduce((sum, leg) => sum + leg.netPnlUsdt, 0) : null;
    trades.push({
      symbol: final.symbol, entryAt: final.entryAt, exitAt: final.at,
      cost, net, returnPct: verified ? 100 * net / cost : null, reason: final.reason || null,
      ...waveState(buys.get(key), final)
    });
  }
  trades.sort((a, b) => timeOf(b.exitAt) - timeOf(a.exitAt));
  const valid = trades.filter(t => Number.isFinite(t.net));
  const winners = groupStats(valid.filter(t => t.net > 0));
  const losers = groupStats(valid.filter(t => t.net < 0));
  const armed = trades.filter(t => t.wave === 'armed').length;
  const notArmed = trades.filter(t => t.wave === 'not_armed').length;
  const thresholdReached = trades.filter(t => t.wave === 'threshold_reached').length;
  const counts = {
    closed: trades.length, verified: valid.length, unknown: trades.length - valid.length,
    wins: winners.count, losses: losers.count, flat: valid.length - winners.count - losers.count,
    armed, notArmed, thresholdReached, unknownWave: trades.length - armed - notArmed - thresholdReached
  };
  return { trades, winners, losers, counts };
}
