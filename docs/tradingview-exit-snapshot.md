# Actual bot exit thresholds in charts

The Binance position map and selected-asset chart display the server's
`effectiveStopPrice`, `targetPrice` and `activationPrice`. These are copied, not
reconstructed from OHLC bars, channel slope, local defaults or a guessed entry.
No orders, account writes, settings changes or extra network requests are added.

The TradingView indicator accepts a read-only `Bot exit snapshot` text input.
The owner updates the existing private indicator once, then pastes the exported
data from the selected managed LIVE position. The current saved layout URL still
contains only symbol and interval, never account data. The snapshot contains no
quantity, credentials or account identifier.

Format: `LEVI_EXIT_V2|EXCHANGE:SYMBOL|observedMs|entryMs|entry|stop|takeProfit|activationOr0|armed0or1|verifiedBrokerStopOr0|LONG_or_SHORT|stopLossPct|takeProfitPct|profitActivationPct|trailingGapPp`

V1 LONG imports remain supported. Missing setting percentages use -1 and display
unknown, never zero. US stocks use US:TICKER, validated against USD stock/fund
charts on NASDAQ/NYSE/AMEX/NYSEARCA; Futures uses BINANCE:TICKER.P. Colmex
exports require a recent broker snapshot and managed position quote. Futures
exports require current account/managed position checks and a supported settings
exit policy; pending or halted accounts are refused. Only actual current
verified native stop prices are marked as verified. All directions use the
server-computed stop/target, including retained stronger protection. Original
settings and actual directional price percentages are shown separately..

Binance Spot export requires a matching managed LONG position and wallet quantity, a supported
exit policy, a current account read and a current `positionQuoteAt` from the
server. Source timestamps must be no more than 120 seconds old and cannot be in
the future. `observedMs` is the oldest source timestamp; copying never renews it.
Missing or stale broker verification is shown separately from the intended exit.
Reaching a threshold is never labelled an executed sale.

Pine rejects malformed data, a different exchange/symbol, a future timestamp or
an expired snapshot. It removes old exit drawings on every last-bar execution.
It does not plot an imagined historical/future sale or reconstruct trailing peaks.
The stop is shown as a dashed horizontal threshold. Take Profit and activation
lines are optional to avoid compressing the price chart; their values remain in
the table. The entry price is drawn as a separate gray line. The snapshot is independent of
the new recent-wave A/B entry model; open positions are not migrated.

This is NOT a live bot connection. Pine cannot discover a later sale, settings
change or new stop until the owner pastes a new snapshot. Expiry is evaluated on
script executions; a market without new updates can leave the last display on
screen. The app remains the source for refreshed status and execution history.

No VPS restart or server update is needed for the Netlify frontend update.
The private saved Pine script is not updated by Netlify publication. It must be
replaced in Pine Editor using the download linked from `/tradingview-channels.html`.
