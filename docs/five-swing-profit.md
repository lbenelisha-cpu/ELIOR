# Frozen five-wave trailing protection

New managed entries use the arithmetic mean percentage of the last five completed
upward swings for LONG, downward swings for SHORT. Pivots require two strictly
lower/higher bars on each side; only closed bars known at the entry snapshot are
eligible. Ambiguous outside-bar pivots are ignored. Current live routes use 5m
candles. The helper also supports explicit 1h and 1d series without mixing periods.

Long wave percentage = (high / low - 1) * 100. Short = (1 - low / high) * 100.
The snapshot includes the five source waves, confirmation times, direction,
timeframe, average, and cutoff, and travels through the durable intent to the fill.
No later market history recalculates the percentage. LONG trails peak * (1-pct/100);
SHORT trails trough * (1+pct/100). Existing activation, hard stop and target remain.
The saved effective stop is never relaxed. Activation does not guarantee positive P/L.

Missing/invalid/insufficient history keeps the existing settings, with a visible
fallback label. Existing positions, and external positions lacking an entry-time
snapshot, are not retroactively assigned new waves. Account holdings without a
managed strategy are not presented as protected by this calculation.

Per-position UI displays the frozen percentage or the fallback distance with its
correct unit. TradingView V3 snapshots label the distance as percentage of peak or
trough; V1/V2 parsing remains supported. Update the Pine indicator from
tradingview/levi-channels.pine to read V3; copied prices remain snapshots, not live
broker instructions. Pine compilation requires TradingView and was not run offline.

## Deployment
Netlify runs the Colmex modules after publication; this does not enable its paused
connection. Binance's separate VPS requires scripts/install-swing-profit.sh with
a reviewed full commit SHA. The installer stages recognized contextual patches,
retains local guards, tests the installed runtime, backs up changed code, checks
for pending entries before and after stopping the service, and rolls back code
on installation failure. Exchange orders and journals are not rolled back.

## Validation
1,380 current runtime tests passed. Dedicated tests cover analytical wave averages,
open/future bar exclusion, invalid history fallback, restart persistence, both
trailing directions, never loosening stops, display/export units, and installer
atomic rejection/idempotency. Older migration installer suites include fixtures
bound to historical source text and are not the acceptance suite for this release.
No live order or Colmex reconnection is used for testing.
