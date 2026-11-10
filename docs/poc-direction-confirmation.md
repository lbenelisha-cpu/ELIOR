# POC direction confirmation

Automatic channel entries in Binance Spot LONG, Binance Futures SHORT, and Colmex LONG/SHORT use `POC_EMA50_1H_RECLAIM_V1`.

The existing confirmed channel, breakout, initial consolidation and A–B volume profile remain prerequisites. A POC touch alone no longer authorizes entry:

- LONG requires a completed 5-minute candle to reclaim above POC after a touch, and both the latest completed hourly close and current execution quote above a rising hourly EMA50.
- SHORT mirrors this: a completed close below POC, and the hourly close and execution quote below a falling EMA50.
- The reclaim must follow frozen B and the latest lifecycle boundary. It is valid only during the immediately following 5-minute candle. The current quote must remain on the confirmed side of both POC and EMA, without extending B.
- Missing, gapped or stale evidence blocks entry. The final execution check recomputes and compares the evidence; an old stored approval is insufficient.

The hourly calculation uses up to 100 completed hourly candles, seeded by the mean of the first 50, with at least 51 required to measure slope. Binance uses UTC hours. Colmex uses regular New York sessions, including the final partial hourly candle. Closed session gaps are allowed; missing intraday bars are not. Futures caches historical candles per reader and refreshes the newest candles on every read; Colmex requests 21 calendar days.

Existing exits, position sizing, account protections and explicitly manual orders retain their existing rules. This is a stricter entry filter, not evidence of improved profitability; no historical profitability comparison was performed in this release.

## TradingView

`tradingview/levi-channels.pine` displays closed-hour EMA50 and closed-candle POC reclaim checks. The `SETUP` panel describes chart analysis, not an open broker position. Different feeds can produce different candles and calculations.

The app's **Bot exit snapshot** supplies the real position side, entry time/price, effective stop and take-profit. LONG labels its stop as the lower barrier and target as the upper barrier; SHORT reverses them. These lines are copied values, not orders or a live account connection. The snapshot expires after two minutes and after a symbol mismatch. Refresh it after position/settings changes. Existing indicator inputs may preserve an older disabled take-profit toggle; enable **Show Take Profit line** to see both barriers.

## Deployment

Netlify deploys app assets and Colmex functions from main. Binance VPS installation is separate:

```sh
cd /opt/levi-binance &&
git fetch origin main &&
revision=<reviewed-full-commit-sha> &&
git show "$revision:scripts/install-direction-confirmation.sh" > /tmp/install-direction-confirmation.sh &&
bash /tmp/install-direction-confirmation.sh "$revision"
```

The installer stages only recognized entry changes against the installed source, runs execution tests, checks pending Spot/SHORT intents before and after stopping, retains local exit integrations and journals, backs up code, then verifies both policy IDs. Unknown source aborts before replacing installed code. Failed health verification restores the code backup without rolling back account journals.
