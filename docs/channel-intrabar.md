# Channel entries during the open candle

Colmex LONG, Binance Spot LONG and Binance Futures SHORT use 50 **closed** five-minute basis candles. Pivot confirmation still requires two subsequent closed candles and at least two touches on each side. The breakout candle is excluded from this basis.

The current broker bid (Colmex/Futures) or fresh exchange trade (Spot) must cross the appropriate projected channel boundary and regression center. The prior closed candle must remain on the original side of that channel boundary. No breakout-candle closing price is required. Current cumulative volume must already reach 1.5 times the previous 20 closed candles' mean; no extrapolation is used. Liquidity, settings, account, capacity, replay and protection checks remain mandatory.

An intent expires at the end of its breakout candle. Its geometry, policy and settings are checked again before submission. A live candle already underway at activation or a previous exit cannot replay as a new signal. Freshness is checked separately for quotes and the volume-bearing live candle. Existing positions retain their recorded exits and the Futures journal schema stays unchanged.

Scanning cadence is unchanged; this does not guarantee execution on the exact tick of the crossing. Colmex still rotates through its scheduled scan batches. POC manual triggers and POC paper research retain their own policies.

Deploy Colmex via the reviewed Netlify release. Install Binance with `scripts/install-channel-intrabar.sh <reviewed full SHA>` after fetching that commit. The installer tests both the release and staged installed runtime, patches only known server integration fragments, backs up code, retains configuration/journals, and verifies both running policy identifiers. No live orders are needed for deployment validation.
