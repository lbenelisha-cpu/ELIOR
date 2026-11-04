# Primary swing-channel entries (Binance) and POC reclaim entries (Colmex)

This opt-in route replaces all other automatic entry routes while requested. Wyckoff and independent breakout remain observable but cannot authorize a buy. Manual confirmations are separate. Existing positions continue their existing exit/protection path, even if channel history or activation is unavailable.

Rules, version CHANNEL_PRIMARY_BREAKOUT_V1:
- 50 closed five-minute candles immediately BEFORE the signal candle; no future data or fitting through the breakout.
- Same confirmed-pivot geometry as parallel-channel.js, with a new optional requireConfirmed selector: only candidates with at least two touches on each boundary qualify, then newest second anchor. Default chart/observation selection remains unchanged.
- A closed candle crosses above the projected upper boundary; the previous close was at/below its prior boundary.
- The regression fitted to the same prior 50 closes slopes upward. Signal close and live price exceed its projected center. Regression is a required direction filter, not a separate entry source.
- Signal volume >=1.5× preceding 20-bar average, with preceding mean dollar volume >=10,000.
- Quote <=15s old on Binance /10s on Colmex, signal expires after five minutes, current price must remain above both channel thresholds and regression center; an earlier wick below these levels is allowed after recovery. Activation/sale boundaries and used channel-anchor IDs prevent stale/repeated entries.
- Colmex uses consecutive trading bars across calendar-verified session gaps. Unknown gaps or missing intraday candles reject. Calendar and session checks remain in the runner.

Reconstruct and compare signal identity/levels from fresh history before submitting. Binance retains account, pause, allocation, risk, native protection and news gates. Colmex retains fresh account/quote/history, bracket permissions, cash sizing and durable intent checks. Channel V2 entries on both platforms use the owner stop percentage, activation threshold and trailing gap. The absolute take-profit is frozen at the breakout level plus the full channel width. Older Colmex routes retain their recorded ATR/structure sizing and older positions retain their policy. Account capacities, currencies, market hours and broker-specific safeguards remain platform-specific.

The earlier 29-sample channel forecast study does not validate these breakout trading rules or demonstrate profitability. Study results never enable this route.

## Activation
Code defaults OFF. For each platform independently, set `<PLATFORM>_CHANNEL_PRIMARY_ENABLED=true` and `<PLATFORM>_CHANNEL_PRIMARY_AFTER=<UTC activation ISO timestamp>`. A requested route with missing activation blocks new automatic buys, rather than falling back to old rules. New signals must close after activation. False restores previously configured entry routes, not a global pause.

Binance owner runs `scripts/install-channel-primary.sh <full SHA> --enable-live`. It stages offline tests and narrowly patches recognized installed server contexts; backs up selected files and its own service override. It never writes trade settings or other service overrides. `--install-only` preserves activation; `--disable-channel-primary` restores old configured routes. Startup rollback cannot reverse any exchange execution.

For Colmex, the same opt-in flag now selects `COLMEX_POC_RECLAIM_V1` instead of the channel-breakout logic described above. Its LONG entry requires 50 closed 5-minute bars, two confirmed higher lows and two confirmed higher highs (each pivot needs two following bars), then estimates a 32-bin volume profile from the later higher low through the following higher high. An intrabar entry requires the open 5-minute candle to trade at/below that POC and the fresh broker bid to reclaim above it; a break beneath the later higher low invalidates the setup. The runner recomputes the structure and POC before the broker order. Volume is estimated by distributing each OHLCV bar's volume across its High–Low range; it is not exchange trade-level Fixed Range Volume Profile data. Existing cash sizing, position limits, broker checks, stops, take-profit and trailing protection remain unchanged.

Colmex owner sets `COLMEX_CHANNEL_PRIMARY_ENABLED=true` and `COLMEX_CHANNEL_PRIMARY_AFTER` in Netlify production function environment and deploys. Final activation changes live automated trading and must be performed by the account owner. Verify `/.netlify/functions/colmex-auto-status` reports strategy `COLMEX_POC_RECLAIM_V1`, and check the latest POC diagnostic in app status. Market-closed time is not an entry failure. Do not create another broker session.
