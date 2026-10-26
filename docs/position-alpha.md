# Position-relative alpha (observation only)

The shared `POSITION_ALPHA_5M_V1` calculation powers both application panels and server decision journal snapshots. MA100/200 remain broad context; these additional observations do not change entry, exit, protection, sizing, or broker permissions.

- Anchor: documented entry price and time. New Binance fills retain an additional broker execution timestamp; legacy Binance and Colmex positions explicitly say “recorded entry time,” which may precede execution. Existing execution identifiers/times remain unchanged.
- Candle point: `(high + low + close) / 3`, normalized to percentage change from entry. Only complete, closed five-minute candles whose opening is at or after entry qualify. Exclude the candle spanning a mid-candle entry.
- Entry alpha: `atan((normalized change / elapsed clock minutes) / 0.01)`. Time includes exchange closures. It can flatten as time passes without the price falling.
- Recent alpha: ordinary least-squares slope over the latest five qualifying contiguous closes (20 elapsed minutes), on the same percentage-point-per-minute scale. No recent slope bridges missing bars or an overnight break.
- Both angles describe price direction, independent of LONG/SHORT. A separate fresh-quote gross P/L reverses the price change for SHORT; this does not enable short trading. Fees, funding and realized net P/L remain in existing accounting views.
- More than ten minutes after the last source close, readings are marked as historical. Missing entry price/time, adopted wallet cost bases and adjusted positions do not receive invented entry anchors. Missing or truncated series are labelled partial; the endpoint-based entry slope can still be calculated when its anchor is documented.

The collapsible panel is above the existing MA panel. Its graph distinguishes the straight entry-to-latest link from observed candle averages; gaps remain visible. It uses existing chart/status requests, with no new frontend polling or provider calls. Colmex uses the existing read-only five-minute context worker. Its latest compact snapshot is keyed to position identity, price and time to prevent reuse after closing and reopening the same symbol.

The existing journal version remains backward compatible. New records carry a compact `positionAlpha` snapshot (without the candle series), source time, entry reference and optional gross quote P/L. Old records say “not recorded in this version.” A new five-minute source close is retained even if the automatic action is unchanged. No historical alpha is backfilled into old decisions.

## Deployment

Netlify publishes the two browser applications and Colmex functions from the merged main branch. The separate Binance VM requires the reviewed commit's `scripts/install-binance-ma-audit.sh`. That installer stages and syntax-checks explicit code files, checks the new snapshot schema, backs up the running files, restarts the service, and rolls back if read-only health verification fails. It preserves credentials and persistent positions. `scripts/verify-binance-ma-audit.mjs` reports aggregate alpha statuses without printing account data or credentials.
