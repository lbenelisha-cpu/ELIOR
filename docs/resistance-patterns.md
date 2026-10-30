# Resistance and breakout chart overlay

Both Binance and Colmex chart renderers display a horizontal resistance band and
the candle where a close first exceeded it. This is browser-only analysis on the
selected chart timeframe, including while a position is held. It neither reads
trading credentials nor changes entry, exit, allocation or protection decisions.

The display examines at most 600 bars up to the visible window's end. A band uses
the high of the preceding 20 closed bars and its lower edge is 0.3% below that
high. It requires tests at least three bars apart and an intervening low at least
0.3% below the lower edge. These are explicit display heuristics, not a validated
strategy or probability of success. Missing, duplicate or malformed candles reset
the analysis; overnight stock-session gaps also reset it conservatively.

Amber means resistance with no closed-bar breakout. Green means a later candle
closed above the fixed upper edge; a vertical dashed line locates that candle.
Pink means a subsequent close fell below the lower edge. A wick or open candle
never confirms a breakout. A failed breakout is not relabelled successful just
because price recovers. Zones expire after 40 additional bars, or 20 bars after
the first breakout. Only the latest retained zone is displayed, clipped to the
visible time/price window. Zooming changes the viewport, not the price evidence.

This overlay is independent of the existing LIVE breakout entry route, which has
its own timeframe, volume, freshness and account checks. A green chart rectangle
does not indicate a submitted order. Historical backtesting and entry ranking
based on these zones are not part of this change.

## Additional Colmex BUY route

The Colmex worker can now select `independent_breakout` alongside its existing
confirmed entry method. The existing method keeps priority when both qualify;
only one intent is submitted. This route uses the existing Binance breakout
criteria: a closed 5-minute candle above all 20 preceding highs, volume at least
1.5 times their mean, mean dollar volume at least USD 10,000, and the MA100/200
downtrend veto. It does not require a Spring or the chart's repeated-touch band.
The chart band is context; its green state alone is not an entry decision.

The worker re-reads history and the broker account, then obtains a fresh quote
before saving a new breakout intent. It verifies the same signal identity and
level, no consumed/expired signal, no live-candle return through resistance,
account permissions, available cash after quarantines, position capacity, and
risk sizing. Existing protection/exit handling runs first. The intent and fill
carry the breakout entry mode and policy version into the trade journal.

**Disabled by default. Publishing this code does not enable additional trades.**
The account owner can enable it in the existing Netlify site's Production
environment, Functions scope, with both values:

- `COLMEX_INDEPENDENT_BREAKOUT_ENABLED=true`
- `COLMEX_INDEPENDENT_BREAKOUT_AFTER=<the activation time in UTC ISO 8601>`

Deploy after saving these values; choose the actual activation time, not a past
historical signal. Only a candle closing strictly after this boundary may enter.
The ordinary LIVE opt-in is still required. To disable only this entry method,
set the first value to `false` and deploy; existing-position protections continue.
Verify `independentEntry.enabled`, `enabledAfter`, and `executionEnabled` in
`/.netlify/functions/colmex-auto-status`, then check `halt`, reservations, broker
readiness and per-symbol `checks[].entryDecisions`. An enabled flag does not prove
that a trade is eligible. Never release unresolved TGT/AMD reservations as part
of enabling this route. Binance execution code and deployment are unchanged.
