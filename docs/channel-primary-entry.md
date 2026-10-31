# Primary swing-channel entries (Binance and Colmex)

This opt-in route replaces all other automatic entry routes while requested. Wyckoff and independent breakout remain observable but cannot authorize a buy. Manual confirmations are separate. Existing positions continue their existing exit/protection path, even if channel history or activation is unavailable.

Rules, version CHANNEL_PRIMARY_BREAKOUT_V1:
- 100 closed five-minute candles immediately BEFORE the signal candle; no future data or fitting through the breakout.
- Same confirmed-pivot geometry as parallel-channel.js, with a new optional requireConfirmed selector: only candidates with at least two touches on each boundary qualify, then newest second anchor. Default chart/observation selection remains unchanged.
- A closed candle crosses above the projected upper boundary; the previous close was at/below its prior boundary.
- The regression fitted to the same prior 100 closes slopes upward. Signal close and live price exceed its projected center. Regression is a required direction filter, not a separate entry source.
- Signal volume >=1.5× preceding 20-bar average, with preceding mean dollar volume >=10,000.
- Quote <=15s old on Binance /10s on Colmex, signal expires after five minutes, current candle low must remain above both channel thresholds and regression center. Activation/sale boundaries and used channel-anchor IDs prevent stale/repeated entries.
- Colmex uses consecutive trading bars across calendar-verified session gaps. Unknown gaps or missing intraday candles reject. Calendar and session checks remain in the runner.

Reconstruct and compare signal identity/levels from fresh history before submitting. Binance retains account, pause, allocation, risk, native protection and news gates. Colmex retains fresh account/quote/history, bracket permissions, cash sizing and durable intent checks. Colmex existing ATR/structure risk sizing is unchanged; Binance remains settings-only stops. Neither route changes exit settings or makes channel edges sell targets.

The earlier 29-sample channel forecast study does not validate these breakout trading rules or demonstrate profitability. Study results never enable this route.

## Activation
Code defaults OFF. For each platform independently, set `<PLATFORM>_CHANNEL_PRIMARY_ENABLED=true` and `<PLATFORM>_CHANNEL_PRIMARY_AFTER=<UTC activation ISO timestamp>`. A requested route with missing activation blocks new automatic buys, rather than falling back to old rules. New signals must close after activation. False restores previously configured entry routes, not a global pause.

Binance owner runs `scripts/install-channel-primary.sh <full SHA> --enable-live`. It stages offline tests and narrowly patches recognized installed server contexts; backs up selected files and its own service override. It never writes trade settings or other service overrides. `--install-only` preserves activation; `--disable-channel-primary` restores old configured routes. Startup rollback cannot reverse any exchange execution.

Colmex owner sets `COLMEX_CHANNEL_PRIMARY_ENABLED=true` and `COLMEX_CHANNEL_PRIMARY_AFTER` in Netlify production function environment and deploys. Final activation changes live automated trading and must be performed by the account owner. Verify `/api/colmex-auto-status` channelPrimary state and app status after deployment. Market-closed time is not an entry failure. Do not create another broker session.
